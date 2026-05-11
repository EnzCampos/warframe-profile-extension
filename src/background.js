import {
  DEFAULT_ALLOWED_ORIGINS,
  EXTENSION_VERSION,
  STORAGE_KEYS,
  buildProfileUrl,
  createError,
  isOriginAllowed,
  isSupportedMessageType,
  mapProfileFetchError,
  normalizeAllowedOrigins,
  normalizeOrigin,
  normalizePlatformKey,
} from "./shared.js";

const WARFRAME_COOKIE_URL = "https://www.warframe.com/";
const GID_COOKIE_NAME = "gid";
const APPROVAL_TIMEOUT_MS = 2 * 60 * 1000;

const pendingApprovals = new Map();

async function storageGet(keys) {
  return chrome.storage.sync.get(keys);
}

async function storageSet(values) {
  return chrome.storage.sync.set(values);
}

async function ensureDefaultAllowlist() {
  const stored = await storageGet(STORAGE_KEYS.allowedOrigins);
  const allowedOrigins = normalizeAllowedOrigins(stored[STORAGE_KEYS.allowedOrigins]);

  if (!arraysEqual(stored[STORAGE_KEYS.allowedOrigins], allowedOrigins)) {
    await storageSet({
      [STORAGE_KEYS.allowedOrigins]: allowedOrigins,
    });
  }
}

function arraysEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

async function getGidCookie() {
  const cookie = await chrome.cookies.get({
    name: GID_COOKIE_NAME,
    url: WARFRAME_COOKIE_URL,
  });
  return cookie?.value?.trim() || "";
}

async function captureGidFromCookie() {
  const accountId = await getGidCookie();
  if (accountId) {
    await storageSet({ [STORAGE_KEYS.accountId]: accountId });
    await chrome.action.setBadgeText({ text: "" });
  }
  return accountId;
}

async function getState() {
  await ensureDefaultAllowlist();
  const stored = await storageGet([
    STORAGE_KEYS.accountId,
    STORAGE_KEYS.allowedOrigins,
    STORAGE_KEYS.platformKey,
  ]);
  const cookieAccountId = await captureGidFromCookie();
  const accountId = cookieAccountId || stored[STORAGE_KEYS.accountId] || "";

  return {
    accountId,
    allowedOrigins: normalizeAllowedOrigins(stored[STORAGE_KEYS.allowedOrigins] ?? DEFAULT_ALLOWED_ORIGINS),
    platformKey: normalizePlatformKey(stored[STORAGE_KEYS.platformKey]),
  };
}

async function handleStatus(senderOrigin) {
  const state = await getState();
  return {
    accountIdPresent: Boolean(state.accountId),
    allowedOrigin: isOriginAllowed(senderOrigin, state.allowedOrigins),
    ok: true,
    platformKey: state.platformKey,
    version: EXTENSION_VERSION,
  };
}

async function handleGetIdentity(senderOrigin) {
  if (!(await ensureOriginApproved(senderOrigin))) {
    return createError("origin_not_allowed", "This website is not allowed to read Warframe profile data.");
  }

  const state = await getState();

  if (!state.accountId) {
    return createError("gid_missing", "Log in to warframe.com so the extension can find your gid Account ID.");
  }

  if (!state.platformKey) {
    await chrome.action.setBadgeText({ text: "!" });
    return createError("platform_required", "Choose your Warframe platform in Warframe Profile Extension.");
  }

  return {
    accountId: state.accountId,
    ok: true,
    platformKey: state.platformKey,
  };
}

async function handleSyncProfile(message, senderOrigin) {
  if (!(await ensureOriginApproved(senderOrigin))) {
    return createError("origin_not_allowed", "This website is not allowed to request Warframe profile sync.");
  }

  const state = await getState();

  const accountId =
    typeof message?.accountId === "string" && message.accountId.trim()
      ? message.accountId.trim()
      : state.accountId;
  const platformKey = normalizePlatformKey(message?.platformKey) ?? state.platformKey;

  if (!accountId) {
    return createError("gid_missing", "Log in to warframe.com so the extension can find your gid Account ID.");
  }

  if (!platformKey) {
    await chrome.action.setBadgeText({ text: "!" });
    return createError("platform_required", "Choose your Warframe platform in Warframe Profile Extension.");
  }

  let profileUrl;
  try {
    profileUrl = buildProfileUrl(accountId, platformKey);
  } catch {
    return createError("unsupported_platform", "The selected Warframe platform is not supported.");
  }

  try {
    const response = await fetch(profileUrl, { cache: "no-store" });
    const jsonText = await response.text();

    if (!response.ok) {
      return createError(
        mapProfileFetchError(response.status),
        `Warframe profile request failed with status ${response.status}.`,
      );
    }

    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed?.Results) || parsed.Results.length === 0) {
        return createError("invalid_profile_json", "Warframe returned JSON, but it was not a profile payload.");
      }
    } catch {
      return createError("invalid_profile_json", "Warframe returned a profile response that was not valid JSON.");
    }

    await storageSet({
      [STORAGE_KEYS.accountId]: accountId,
      [STORAGE_KEYS.platformKey]: platformKey,
    });
    await chrome.action.setBadgeText({ text: "" });

    return {
      accountId,
      fetchedAt: new Date().toISOString(),
      jsonText,
      ok: true,
      platformKey,
    };
  } catch {
    return createError("network_error", "The extension could not reach the Warframe profile endpoint.");
  }
}

async function ensureOriginApproved(senderOrigin) {
  const normalizedOrigin = normalizeOrigin(senderOrigin);
  if (!normalizedOrigin) {
    return false;
  }

  await ensureDefaultAllowlist();
  const stored = await storageGet(STORAGE_KEYS.allowedOrigins);
  const allowedOrigins = normalizeAllowedOrigins(stored[STORAGE_KEYS.allowedOrigins] ?? DEFAULT_ALLOWED_ORIGINS);

  if (isOriginAllowed(normalizedOrigin, allowedOrigins)) {
    return true;
  }

  return requestOriginApproval(normalizedOrigin);
}

async function requestOriginApproval(origin) {
  if (pendingApprovals.has(origin)) {
    return pendingApprovals.get(origin).promise;
  }

  const popupUrl = chrome.runtime.getURL(`approval.html?origin=${encodeURIComponent(origin)}`);
  const pending = {};
  pending.promise = new Promise((resolve) => {
    pending.resolve = resolve;
  });
  pending.timeoutId = setTimeout(() => finishApproval(origin, false), APPROVAL_TIMEOUT_MS);
  pendingApprovals.set(origin, pending);

  try {
    const windowInfo = await chrome.windows.create({
      focused: true,
      height: 330,
      type: "popup",
      url: popupUrl,
      width: 420,
    });
    pending.windowId = windowInfo.id;
  } catch {
    finishApproval(origin, false);
  }

  return pending.promise;
}

async function approveOrigin(origin) {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin || !pendingApprovals.has(normalizedOrigin)) {
    return false;
  }

  const stored = await storageGet(STORAGE_KEYS.allowedOrigins);
  const allowedOrigins = normalizeAllowedOrigins(stored[STORAGE_KEYS.allowedOrigins] ?? DEFAULT_ALLOWED_ORIGINS);
  const nextAllowedOrigins = normalizeAllowedOrigins([...allowedOrigins, normalizedOrigin]);
  await storageSet({ [STORAGE_KEYS.allowedOrigins]: nextAllowedOrigins });
  finishApproval(normalizedOrigin, true);
  return true;
}

function refuseOrigin(origin) {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin || !pendingApprovals.has(normalizedOrigin)) {
    return false;
  }

  finishApproval(normalizedOrigin, false);
  return true;
}

function finishApproval(origin, approved) {
  const pending = pendingApprovals.get(origin);
  if (!pending) {
    return;
  }

  pendingApprovals.delete(origin);
  clearTimeout(pending.timeoutId);
  pending.resolve(approved);
}

async function handleExternalMessage(message, sender) {
  const senderOrigin = normalizeOrigin(sender?.origin ?? sender?.url ?? "");

  if (!isSupportedMessageType(message?.type)) {
    return createError("unsupported_message", "Unsupported Warframe Profile Extension message.");
  }

  if (message.type === "warframeProfile.status") {
    return handleStatus(senderOrigin);
  }

  if (message.type === "warframeProfile.getIdentity") {
    return handleGetIdentity(senderOrigin);
  }

  return handleSyncProfile(message, senderOrigin);
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaultAllowlist();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "warframeProfile.captureGid") {
    void captureGidFromCookie()
      .then((accountId) => sendResponse({ accountIdPresent: Boolean(accountId), ok: true }))
      .catch(() => sendResponse(createError("gid_missing", "The gid cookie is not available yet.")));
    return true;
  }

  if (message?.type === "warframeProfile.approvalDecision") {
    const decide = message.approved ? approveOrigin : refuseOrigin;
    void Promise.resolve(decide(message.origin))
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse(createError("approval_failed", "The approval request could not be completed.")));
    return true;
  }

  if (message?.type === "warframeProfile.forwardExternal") {
    const senderOrigin = normalizeOrigin(message.origin);
    void handleExternalMessage(message.payload, { origin: senderOrigin }).then(sendResponse);
    return true;
  }

  return false;
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  void handleExternalMessage(message, sender).then(sendResponse);
  return true;
});

chrome.windows.onRemoved.addListener((windowId) => {
  for (const [origin, pending] of pendingApprovals.entries()) {
    if (pending.windowId === windowId) {
      finishApproval(origin, false);
      return;
    }
  }
});

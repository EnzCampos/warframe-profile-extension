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

async function storageGet(keys) {
  return chrome.storage.sync.get(keys);
}

async function storageSet(values) {
  return chrome.storage.sync.set(values);
}

async function ensureDefaultAllowlist() {
  const stored = await storageGet(STORAGE_KEYS.allowedOrigins);
  const allowedOrigins = normalizeAllowedOrigins(stored[STORAGE_KEYS.allowedOrigins]);

  if (allowedOrigins.length === 0) {
    await storageSet({
      [STORAGE_KEYS.allowedOrigins]: DEFAULT_ALLOWED_ORIGINS,
    });
  }
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
  const state = await getState();

  if (!isOriginAllowed(senderOrigin, state.allowedOrigins)) {
    return createError("origin_not_allowed", "This website is not allowed to read Warframe profile data.");
  }

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
  const state = await getState();

  if (!isOriginAllowed(senderOrigin, state.allowedOrigins)) {
    return createError("origin_not_allowed", "This website is not allowed to request Warframe profile sync.");
  }

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

async function handleExternalMessage(message, sender) {
  const senderOrigin = normalizeOrigin(sender?.origin ?? sender?.url ?? "");

  if (!isSupportedMessageType(message?.type)) {
    return createError("unsupported_message", "Unsupported Warframe Profile Extension message.");
  }

  if (message.type === "wftracker.status") {
    return handleStatus(senderOrigin);
  }

  if (message.type === "wftracker.getIdentity") {
    return handleGetIdentity(senderOrigin);
  }

  return handleSyncProfile(message, senderOrigin);
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaultAllowlist();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "wftracker.captureGid") {
    return false;
  }

  void captureGidFromCookie()
    .then((accountId) => sendResponse({ accountIdPresent: Boolean(accountId), ok: true }))
    .catch(() => sendResponse(createError("gid_missing", "The gid cookie is not available yet.")));
  return true;
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  void handleExternalMessage(message, sender).then(sendResponse);
  return true;
});

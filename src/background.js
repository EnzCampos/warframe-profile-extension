import {
  DEFAULT_ALLOWED_ORIGINS,
  EXTENSION_VERSION,
  STORAGE_KEYS,
  buildProfileCacheKey,
  buildProfileUrl,
  createProfileCacheEntry,
  createError,
  isOriginAllowed,
  isProfileCacheEntryFor,
  isProfileCacheEntryFresh,
  isSupportedMessageType,
  mapProfileFetchError,
  normalizeAllowedOrigins,
  normalizeOrigin,
  normalizePlatformKey,
} from "./shared.js";

const WARFRAME_COOKIE_URL = "https://www.warframe.com/";
const GID_COOKIE_NAME = "gid";
const PROFILE_403_STALE_TTL_MS = 60 * 60 * 1000;

async function storageGet(keys) {
  return chrome.storage.sync.get(keys);
}

async function storageSet(values) {
  return chrome.storage.sync.set(values);
}

async function localStorageGet(keys) {
  return chrome.storage.local.get(keys);
}

async function localStorageSet(values) {
  return chrome.storage.local.set(values);
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

async function handleSyncProfile(message, senderOrigin, { skipOriginCheck = false } = {}) {
  const state = await getState();

  if (!skipOriginCheck && !isOriginAllowed(senderOrigin, state.allowedOrigins)) {
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

  const cachedEntry = await getProfileCacheEntry(accountId, platformKey);
  if (isProfileCacheEntryFresh(cachedEntry)) {
    await persistProfileSelection(accountId, platformKey);
    await chrome.action.setBadgeText({ text: "" });
    return createProfileResponse(cachedEntry, { cached: true, stale: false });
  }

  if (isProfileCacheRefreshDeferred(cachedEntry)) {
    await persistProfileSelection(accountId, platformKey);
    await chrome.action.setBadgeText({ text: "" });
    return createProfileResponse(cachedEntry, {
      cached: true,
      refreshError: cachedEntry.refreshError,
      stale: true,
    });
  }

  try {
    const response = await fetch(profileUrl, { cache: "no-store" });
    const jsonText = await response.text();

    if (!response.ok) {
      const errorResponse = createError(
        mapProfileFetchError(response.status),
        `Warframe profile request failed with status ${response.status}.`,
      );

      if (response.status === 403 && cachedEntry) {
        const deferredEntry = await deferProfileCacheRefresh(cachedEntry, errorResponse.error);
        return createProfileResponse(deferredEntry, {
          cached: true,
          refreshError: errorResponse.error,
          stale: true,
        });
      }

      return createProfileRefreshFailure(
        cachedEntry,
        errorResponse,
      );
    }

    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed?.Results) || parsed.Results.length === 0) {
        return createProfileRefreshFailure(
          cachedEntry,
          createError("invalid_profile_json", "Warframe returned JSON, but it was not a profile payload."),
        );
      }
    } catch {
      return createProfileRefreshFailure(
        cachedEntry,
        createError("invalid_profile_json", "Warframe returned a profile response that was not valid JSON."),
      );
    }

    const fetchedAt = new Date().toISOString();
    const cacheEntry = createProfileCacheEntry({
      accountId,
      cacheControl: response.headers.get("Cache-Control") ?? "",
      fetchedAt,
      jsonText,
      platformKey,
    });

    if (cacheEntry) {
      await saveProfileCacheEntry(cacheEntry);
    }

    await persistProfileSelection(accountId, platformKey);
    await chrome.action.setBadgeText({ text: "" });

    return createProfileResponse(
      cacheEntry ?? {
        accountId,
        expiresAt: fetchedAt,
        fetchedAt,
        jsonText,
        nextRefreshAt: fetchedAt,
        platformKey,
      },
      { cached: false, stale: false },
    );
  } catch {
    return createProfileRefreshFailure(
      cachedEntry,
      createError("network_error", "The extension could not reach the Warframe profile endpoint."),
    );
  }
}

async function persistProfileSelection(accountId, platformKey) {
  try {
    await storageSet({
      [STORAGE_KEYS.accountId]: accountId,
      [STORAGE_KEYS.platformKey]: platformKey,
    });
  } catch {
    // Profile delivery should not fail only because preference persistence failed.
  }
}

async function getProfileCacheEntry(accountId, platformKey) {
  const cacheKey = buildProfileCacheKey(accountId, platformKey);
  if (!cacheKey) {
    return null;
  }

  try {
    const stored = await localStorageGet(STORAGE_KEYS.profileCache);
    const cache = normalizeProfileCache(stored[STORAGE_KEYS.profileCache]);
    const entry = cache[cacheKey];

    return isProfileCacheEntryFor(entry, accountId, platformKey) ? entry : null;
  } catch {
    return null;
  }
}

async function saveProfileCacheEntry(entry) {
  const cacheKey = buildProfileCacheKey(entry.accountId, entry.platformKey);
  if (!cacheKey) {
    return;
  }

  try {
    const stored = await localStorageGet(STORAGE_KEYS.profileCache);
    const cache = normalizeProfileCache(stored[STORAGE_KEYS.profileCache]);
    await localStorageSet({
      [STORAGE_KEYS.profileCache]: {
        ...cache,
        [cacheKey]: entry,
      },
    });
  } catch {
    // A cache write failure should not block delivery of a freshly fetched profile.
  }
}

function normalizeProfileCache(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isProfileCacheRefreshDeferred(entry, now = new Date()) {
  if (!entry?.refreshError || entry.refreshError.code !== "profile_403") {
    return false;
  }

  const nextRefreshAtMs = Date.parse(entry.nextRefreshAt);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);

  return (
    !isProfileCacheEntryFresh(entry, now) &&
    Number.isFinite(nextRefreshAtMs) &&
    Number.isFinite(nowMs) &&
    nextRefreshAtMs > nowMs
  );
}

async function deferProfileCacheRefresh(cachedEntry, refreshError) {
  const deferredEntry = {
    ...cachedEntry,
    nextRefreshAt: new Date(Date.now() + PROFILE_403_STALE_TTL_MS).toISOString(),
    refreshError,
  };

  await saveProfileCacheEntry(deferredEntry);
  return deferredEntry;
}

function createProfileResponse(entry, { cached, stale, refreshError } = {}) {
  return {
    accountId: entry.accountId,
    cached,
    expiresAt: entry.expiresAt,
    fetchedAt: entry.fetchedAt,
    jsonText: entry.jsonText,
    nextRefreshAt: entry.nextRefreshAt,
    ok: true,
    platformKey: entry.platformKey,
    stale,
    ...(refreshError ? { refreshError } : {}),
  };
}

function createProfileRefreshFailure(cachedEntry, errorResponse) {
  if (cachedEntry) {
    return createProfileResponse(cachedEntry, {
      cached: true,
      refreshError: errorResponse.error,
      stale: true,
    });
  }

  return errorResponse;
}

async function approveOrigin(origin) {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }

  const stored = await storageGet(STORAGE_KEYS.allowedOrigins);
  const allowedOrigins = normalizeAllowedOrigins(stored[STORAGE_KEYS.allowedOrigins] ?? DEFAULT_ALLOWED_ORIGINS);
  const nextAllowedOrigins = normalizeAllowedOrigins([...allowedOrigins, normalizedOrigin]);
  await storageSet({ [STORAGE_KEYS.allowedOrigins]: nextAllowedOrigins });
  return true;
}

export async function handleExternalMessage(message, sender) {
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

  if (message.type === "warframeProfile.requestOriginApproval") {
    return createError(
      "origin_not_allowed",
      "Open this site in a tab where the Warframe Profile Extension can run, then approve the site from the page prompt.",
    );
  }

  return handleSyncProfile(message, senderOrigin);
}

export async function handleLocalProfileSync(message) {
  return handleSyncProfile(message, "", { skipOriginCheck: true });
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

  if (message?.type === "warframeProfile.trustOrigin") {
    const senderOrigin = normalizeOrigin(_sender?.origin ?? _sender?.url ?? message.origin ?? "");
    void approveOrigin(senderOrigin)
      .then((ok) => sendResponse({ ok }))
      .catch(() => sendResponse(createError("approval_failed", "The approval request could not be completed.")));
    return true;
  }

  if (message?.type === "warframeProfile.syncProfileInternal") {
    void handleLocalProfileSync(message).then(sendResponse);
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

export const EXTENSION_VERSION = "0.1.0";

export const STORAGE_KEYS = {
  accountId: "warframeProfile.accountId",
  allowedOrigins: "warframeProfile.allowedOrigins",
  platformKey: "warframeProfile.platformKey",
  profileCache: "warframeProfile.profileCache",
};

export const DEFAULT_ALLOWED_ORIGINS = [];
export const DEFAULT_PROFILE_CACHE_TTL_SECONDS = 15 * 60;

export const PLATFORM_OPTIONS = [
  { key: "pc", label: "PC", endpoint: "https://api.warframe.com/cdn/getProfileViewingData.php" },
  { key: "ps4", label: "PlayStation", endpoint: "http://content-ps4.warframe.com/dynamic/getProfileViewingData.php" },
  { key: "xb1", label: "Xbox", endpoint: "http://content-xb1.warframe.com/dynamic/getProfileViewingData.php" },
  { key: "swi", label: "Switch", endpoint: "http://content-swi.warframe.com/dynamic/getProfileViewingData.php" },
  { key: "mob", label: "iOS", endpoint: "http://content-mob.warframe.com/dynamic/getProfileViewingData.php" },
  { key: "and", label: "Android", endpoint: "http://content-and.warframe.com/dynamic/getProfileViewingData.php" },
];

const PLATFORM_BY_KEY = new Map(PLATFORM_OPTIONS.map((platform) => [platform.key, platform]));

export function normalizeOrigin(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function normalizeTrustedSiteInput(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed === "*") {
    return null;
  }

  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)) {
    return normalizeOrigin(trimmed);
  }

  const protocol = /^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(trimmed) ? "http" : "https";
  return normalizeOrigin(`${protocol}://${trimmed}`);
}

export function normalizeAllowedOrigins(values) {
  const normalized = new Set();

  for (const value of Array.isArray(values) ? values : []) {
    const origin = normalizeOrigin(value);
    if (origin) {
      normalized.add(origin);
    }
  }

  return [...normalized].sort((left, right) => left.localeCompare(right));
}

export function isOriginAllowed(origin, allowedOrigins) {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }

  return normalizeAllowedOrigins(allowedOrigins).includes(normalizedOrigin);
}

export function normalizePlatformKey(platformKey) {
  const normalized = typeof platformKey === "string" ? platformKey.trim().toLowerCase() : "";
  return PLATFORM_BY_KEY.has(normalized) ? normalized : null;
}

export function buildProfileUrl(accountId, platformKey) {
  const trimmedAccountId = typeof accountId === "string" ? accountId.trim() : "";
  if (!trimmedAccountId) {
    throw new Error("gid_missing");
  }

  const normalizedPlatformKey = normalizePlatformKey(platformKey);
  if (!normalizedPlatformKey) {
    throw new Error("unsupported_platform");
  }

  const platform = PLATFORM_BY_KEY.get(normalizedPlatformKey);
  const url = new URL(platform.endpoint);
  url.searchParams.set("playerId", trimmedAccountId);
  return url.toString();
}

export function createError(code, message) {
  return {
    error: {
      code,
      message,
    },
    ok: false,
  };
}

export function isSupportedMessageType(type) {
  return (
    type === "warframeProfile.status" ||
    type === "warframeProfile.getIdentity" ||
    type === "warframeProfile.syncProfile"
  );
}

export function mapProfileFetchError(status) {
  if (status === 403) return "profile_403";
  if (status === 404) return "profile_404";
  return "network_error";
}

export function buildProfileCacheKey(accountId, platformKey) {
  const trimmedAccountId = typeof accountId === "string" ? accountId.trim() : "";
  const normalizedPlatformKey = normalizePlatformKey(platformKey);

  if (!trimmedAccountId || !normalizedPlatformKey) {
    return null;
  }

  return `${normalizedPlatformKey}:${encodeURIComponent(trimmedAccountId)}`;
}

export function parseProfileCacheMaxAge(cacheControl) {
  if (typeof cacheControl !== "string") {
    return DEFAULT_PROFILE_CACHE_TTL_SECONDS;
  }

  const maxAgeDirective = cacheControl
    .split(",")
    .map((directive) => directive.trim())
    .find((directive) => /^max-age\s*=/i.test(directive));
  const maxAgeValue = maxAgeDirective?.split("=")[1]?.trim();
  const maxAgeSeconds = Number(maxAgeValue);

  return Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0
    ? Math.max(Math.floor(maxAgeSeconds), DEFAULT_PROFILE_CACHE_TTL_SECONDS)
    : DEFAULT_PROFILE_CACHE_TTL_SECONDS;
}

export function createProfileCacheEntry({ accountId, cacheControl, fetchedAt, jsonText, platformKey }) {
  const normalizedPlatformKey = normalizePlatformKey(platformKey);
  const trimmedAccountId = typeof accountId === "string" ? accountId.trim() : "";
  const fetchedAtMs = Date.parse(fetchedAt);

  if (!trimmedAccountId || !normalizedPlatformKey || typeof jsonText !== "string" || Number.isNaN(fetchedAtMs)) {
    return null;
  }

  const ttlSeconds = parseProfileCacheMaxAge(cacheControl);
  const expiresAt = new Date(fetchedAtMs + ttlSeconds * 1000).toISOString();

  return {
    accountId: trimmedAccountId,
    cacheControl: typeof cacheControl === "string" ? cacheControl : "",
    expiresAt,
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    jsonText,
    nextRefreshAt: expiresAt,
    platformKey: normalizedPlatformKey,
  };
}

export function isProfileCacheEntryFresh(entry, now = new Date()) {
  if (!entry || typeof entry !== "object") {
    return false;
  }

  const expiresAtMs = Date.parse(entry.expiresAt);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);

  return Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && expiresAtMs > nowMs;
}

export function isProfileCacheEntryFor(entry, accountId, platformKey) {
  return (
    entry?.accountId === (typeof accountId === "string" ? accountId.trim() : "") &&
    entry?.platformKey === normalizePlatformKey(platformKey) &&
    typeof entry?.jsonText === "string" &&
    Boolean(entry.fetchedAt) &&
    Boolean(entry.expiresAt) &&
    Boolean(entry.nextRefreshAt)
  );
}

export function extractProfileSummary(jsonText) {
  if (typeof jsonText !== "string" || !jsonText.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText);
    const profile = Array.isArray(parsed?.Results) ? parsed.Results[0] : null;
    if (!profile || typeof profile !== "object") {
      return null;
    }

    const displayName = firstStringValue(profile, ["DisplayName", "PlayerName", "playerName", "name"]);
    const masteryRank = firstFiniteNumberValue(profile, ["MasteryRank", "masteryRank", "MasteryLevel", "PlayerLevel"]);

    if (!displayName && masteryRank === null) {
      return null;
    }

    return {
      displayName,
      masteryRank,
    };
  } catch {
    return null;
  }
}

function firstStringValue(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function firstFiniteNumberValue(source, keys) {
  for (const key of keys) {
    const value = source[key];
    const numberValue = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numberValue)) {
      return Math.floor(numberValue);
    }
  }

  return null;
}

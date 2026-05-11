export const EXTENSION_VERSION = "0.1.0";

export const STORAGE_KEYS = {
  accountId: "wftracker.accountId",
  allowedOrigins: "wftracker.allowedOrigins",
  platformKey: "wftracker.platformKey",
};

export const DEFAULT_ALLOWED_ORIGINS = [
  "https://wftracker.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
];

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
    type === "wftracker.status" ||
    type === "wftracker.getIdentity" ||
    type === "wftracker.syncProfile"
  );
}

export function mapProfileFetchError(status) {
  if (status === 403) return "profile_403";
  if (status === 404) return "profile_404";
  return "network_error";
}

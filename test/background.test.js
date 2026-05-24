import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  STORAGE_KEYS,
  buildProfileCacheKey,
  createProfileCacheEntry,
} from "../src/shared.js";

const ALLOWED_ORIGIN = "https://wf-tracker.com";
const ACCOUNT_ID = "wf-123";
const PLATFORM_KEY = "pc";
const VALID_PROFILE_JSON = JSON.stringify({ Results: [{ PlayerName: "Tenno" }] });

describe("background profile persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T12:05:00.000Z"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  test("serves a fresh cached profile without fetching", async () => {
    const localStore = profileCacheStore([
      freshCacheEntry({
        fetchedAt: "2026-05-11T12:00:00.000Z",
      }),
    ]);
    const fetchMock = vi.fn();
    const { handleExternalMessage } = await importBackground({ fetchMock, localStore });

    const response = await syncProfile(handleExternalMessage);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      accountId: ACCOUNT_ID,
      cached: true,
      fetchedAt: "2026-05-11T12:00:00.000Z",
      ok: true,
      platformKey: PLATFORM_KEY,
      stale: false,
    });
    expect(response.expiresAt).toBe("2026-05-11T12:15:00.000Z");
    expect(response.nextRefreshAt).toBe("2026-05-11T12:15:00.000Z");
    expect(response.jsonText).toBe(VALID_PROFILE_JSON);
  });

  test("refreshes an expired cache entry and stores the new profile metadata", async () => {
    const localStore = profileCacheStore([
      freshCacheEntry({
        fetchedAt: "2026-05-11T11:00:00.000Z",
      }),
    ]);
    const fetchMock = vi.fn(async () => profileResponse(VALID_PROFILE_JSON, "public, max-age=120"));
    const { handleExternalMessage } = await importBackground({ fetchMock, localStore });

    const response = await syncProfile(handleExternalMessage);
    const cacheKey = buildProfileCacheKey(ACCOUNT_ID, PLATFORM_KEY);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response).toMatchObject({
      accountId: ACCOUNT_ID,
      cached: false,
      expiresAt: "2026-05-11T12:20:00.000Z",
      fetchedAt: "2026-05-11T12:05:00.000Z",
      nextRefreshAt: "2026-05-11T12:20:00.000Z",
      ok: true,
      platformKey: PLATFORM_KEY,
      stale: false,
    });
    expect(localStore[STORAGE_KEYS.profileCache][cacheKey]).toMatchObject({
      cacheControl: "public, max-age=120",
      expiresAt: "2026-05-11T12:20:00.000Z",
      fetchedAt: "2026-05-11T12:05:00.000Z",
      jsonText: VALID_PROFILE_JSON,
    });
  });

  test("returns stale cached data when an expired refresh fails", async () => {
    const localStore = profileCacheStore([
      freshCacheEntry({
        fetchedAt: "2026-05-11T11:00:00.000Z",
      }),
    ]);
    const fetchMock = vi.fn(async () => profileResponse("Server error", "public, max-age=120", 500));
    const { handleExternalMessage } = await importBackground({ fetchMock, localStore });

    const response = await syncProfile(handleExternalMessage);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response).toMatchObject({
      accountId: ACCOUNT_ID,
      cached: true,
      fetchedAt: "2026-05-11T11:00:00.000Z",
      ok: true,
      platformKey: PLATFORM_KEY,
      refreshError: {
        code: "network_error",
        message: "Warframe profile request failed with status 500.",
      },
      stale: true,
    });
    expect(response.jsonText).toBe(VALID_PROFILE_JSON);
  });

  test("backs off 403 refreshes and serves stale cached data for one hour", async () => {
    const localStore = profileCacheStore([
      freshCacheEntry({
        fetchedAt: "2026-05-11T11:00:00.000Z",
      }),
    ]);
    const fetchMock = vi.fn(async () => profileResponse("Forbidden", "public, max-age=120", 403));
    const { handleExternalMessage } = await importBackground({ fetchMock, localStore });

    const firstResponse = await syncProfile(handleExternalMessage);
    const cacheKey = buildProfileCacheKey(ACCOUNT_ID, PLATFORM_KEY);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstResponse).toMatchObject({
      cached: true,
      nextRefreshAt: "2026-05-11T13:05:00.000Z",
      refreshError: {
        code: "profile_403",
        message: "Warframe profile request failed with status 403.",
      },
      stale: true,
    });
    expect(localStore[STORAGE_KEYS.profileCache][cacheKey]).toMatchObject({
      expiresAt: "2026-05-11T11:15:00.000Z",
      nextRefreshAt: "2026-05-11T13:05:00.000Z",
      refreshError: {
        code: "profile_403",
        message: "Warframe profile request failed with status 403.",
      },
    });

    vi.setSystemTime(new Date("2026-05-11T12:30:00.000Z"));

    const secondResponse = await syncProfile(handleExternalMessage);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(secondResponse).toMatchObject({
      cached: true,
      nextRefreshAt: "2026-05-11T13:05:00.000Z",
      refreshError: {
        code: "profile_403",
        message: "Warframe profile request failed with status 403.",
      },
      stale: true,
    });
    expect(secondResponse.jsonText).toBe(VALID_PROFILE_JSON);
  });

  test("returns the existing error shape when refresh fails without cached data", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    const { handleExternalMessage } = await importBackground({ fetchMock, localStore: {} });

    const response = await syncProfile(handleExternalMessage);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response).toEqual({
      error: {
        code: "network_error",
        message: "The extension could not reach the Warframe profile endpoint.",
      },
      ok: false,
    });
  });

  test("does not serve a cache entry from a different account or platform", async () => {
    const wrongPlatformEntry = freshCacheEntry({
      fetchedAt: "2026-05-11T12:00:00.000Z",
      platformKey: "ps4",
    });
    const localStore = profileCacheStore([wrongPlatformEntry]);
    const fetchMock = vi.fn(async () => profileResponse(VALID_PROFILE_JSON, "public, max-age=600"));
    const { handleExternalMessage } = await importBackground({ fetchMock, localStore });

    const response = await syncProfile(handleExternalMessage);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.cached).toBe(false);
    expect(response.platformKey).toBe(PLATFORM_KEY);
  });

  test("allows the extension UI to load profile data without an external origin", async () => {
    const fetchMock = vi.fn(async () => profileResponse(VALID_PROFILE_JSON, "public, max-age=600"));
    const { handleLocalProfileSync } = await importBackground({ fetchMock, localStore: {} });

    const response = await handleLocalProfileSync({
      accountId: ACCOUNT_ID,
      platformKey: PLATFORM_KEY,
      type: "warframeProfile.syncProfileInternal",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response).toMatchObject({
      accountId: ACCOUNT_ID,
      cached: false,
      ok: true,
      platformKey: PLATFORM_KEY,
      stale: false,
    });
  });

  test("direct external approval requests explain that page access is required", async () => {
    const { handleExternalMessage } = await importBackground({
      fetchMock: vi.fn(),
      localStore: {},
    });

    const response = await handleExternalMessage(
      { type: "warframeProfile.requestOriginApproval" },
      { origin: "https://not-approved.example" },
    );

    expect(response).toEqual({
      error: {
        code: "origin_not_allowed",
        message:
          "Open this site in a tab where the Warframe Profile Extension can run, then approve the site from the page prompt.",
      },
      ok: false,
    });
  });
});

async function importBackground({ fetchMock, localStore }) {
  const syncStore = {
    [STORAGE_KEYS.accountId]: ACCOUNT_ID,
    [STORAGE_KEYS.allowedOrigins]: [ALLOWED_ORIGIN],
    [STORAGE_KEYS.platformKey]: PLATFORM_KEY,
  };

  vi.stubGlobal("chrome", {
    action: {
      setBadgeText: vi.fn(async () => undefined),
    },
    cookies: {
      get: vi.fn(async () => null),
    },
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
      onMessageExternal: { addListener: vi.fn() },
    },
    storage: {
      local: createStorageArea(localStore),
      sync: createStorageArea(syncStore),
    },
  });
  vi.stubGlobal("fetch", fetchMock);

  vi.resetModules();
  return import("../src/background.js");
}

function createStorageArea(store) {
  return {
    get: vi.fn(async (keys) => pickStoredValues(store, keys)),
    set: vi.fn(async (values) => {
      Object.assign(store, values);
    }),
  };
}

function pickStoredValues(store, keys) {
  if (typeof keys === "string") {
    return { [keys]: store[keys] };
  }

  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.map((key) => [key, store[key]]));
  }

  if (keys && typeof keys === "object") {
    return Object.fromEntries(
      Object.entries(keys).map(([key, defaultValue]) => [key, store[key] ?? defaultValue]),
    );
  }

  return { ...store };
}

function syncProfile(handleExternalMessage, message = {}) {
  return handleExternalMessage(
    {
      type: "warframeProfile.syncProfile",
      ...message,
    },
    { origin: ALLOWED_ORIGIN },
  );
}

function profileResponse(body, cacheControl, status = 200) {
  return new Response(body, {
    headers: {
      "Cache-Control": cacheControl,
    },
    status,
  });
}

function profileCacheStore(entries) {
  return {
    [STORAGE_KEYS.profileCache]: Object.fromEntries(
      entries.map((entry) => [buildProfileCacheKey(entry.accountId, entry.platformKey), entry]),
    ),
  };
}

function freshCacheEntry({
  accountId = ACCOUNT_ID,
  cacheControl = "public, max-age=600",
  fetchedAt,
  jsonText = VALID_PROFILE_JSON,
  platformKey = PLATFORM_KEY,
}) {
  return createProfileCacheEntry({
    accountId,
    cacheControl,
    fetchedAt,
    jsonText,
    platformKey,
  });
}

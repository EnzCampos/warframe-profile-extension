import { describe, expect, test } from "vitest";
import {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_PROFILE_CACHE_TTL_SECONDS,
  buildProfileCacheKey,
  buildProfileUrl,
  createProfileCacheEntry,
  extractProfileSummary,
  isOriginAllowed,
  isProfileCacheEntryFresh,
  isSupportedMessageType,
  mapProfileFetchError,
  normalizeAllowedOrigins,
  normalizePlatformKey,
  normalizeTrustedSiteInput,
  parseProfileCacheMaxAge,
} from "../src/shared.js";

describe("extension core helpers", () => {
  test("normalizes and deduplicates trusted origins", () => {
    expect(
      normalizeAllowedOrigins([
        "https://example.com/path",
        "https://example.com/other",
        "bad-url",
        "http://localhost:3000/mastery",
        "*",
      ]),
    ).toEqual(["http://localhost:3000", "https://example.com"]);
  });

  test("checks external consumer origins against trusted origins", () => {
    expect(
      isOriginAllowed("https://not-approved.example", DEFAULT_ALLOWED_ORIGINS),
    ).toBe(false);
    expect(
      isOriginAllowed("not-a-url", DEFAULT_ALLOWED_ORIGINS),
    ).toBe(false);
    expect(isOriginAllowed("https://not-approved.example", ["https://wf-tracker.com"])).toBe(false);
    expect(isOriginAllowed("https://wf-tracker.com", ["https://wf-tracker.com"])).toBe(true);
  });

  test("normalizes trusted site input", () => {
    expect(normalizeTrustedSiteInput("wf-tracker.com")).toBe("https://wf-tracker.com");
    expect(normalizeTrustedSiteInput("https://wf-tracker.com/path")).toBe("https://wf-tracker.com");
    expect(normalizeTrustedSiteInput("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeTrustedSiteInput("http://localhost:3000/profile")).toBe("http://localhost:3000");
    expect(normalizeTrustedSiteInput("*")).toBeNull();
    expect(normalizeTrustedSiteInput("not a valid site")).toBeNull();
  });

  test("builds profile URLs for supported platforms", () => {
    expect(buildProfileUrl("wf-123", "pc")).toBe(
      "https://api.warframe.com/cdn/getProfileViewingData.php?playerId=wf-123",
    );
    expect(buildProfileUrl("wf-123", "ps4")).toBe(
      "http://content-ps4.warframe.com/dynamic/getProfileViewingData.php?playerId=wf-123",
    );
  });

  test("normalizes platform keys and maps fetch errors", () => {
    expect(normalizePlatformKey(" PC ")).toBe("pc");
    expect(normalizePlatformKey("unknown")).toBeNull();
    expect(mapProfileFetchError(403)).toBe("profile_403");
    expect(mapProfileFetchError(404)).toBe("profile_404");
    expect(mapProfileFetchError(500)).toBe("network_error");
  });

  test("supports explicit origin approval messages", () => {
    expect(isSupportedMessageType("warframeProfile.requestOriginApproval")).toBe(true);
    expect(isSupportedMessageType("warframeProfile.status")).toBe(true);
    expect(isSupportedMessageType("warframeProfile.unknown")).toBe(false);
  });

  test("parses profile cache max-age from Cache-Control", () => {
    expect(parseProfileCacheMaxAge("public, max-age=600")).toBe(DEFAULT_PROFILE_CACHE_TTL_SECONDS);
    expect(parseProfileCacheMaxAge("max-age=120, public")).toBe(DEFAULT_PROFILE_CACHE_TTL_SECONDS);
    expect(parseProfileCacheMaxAge("max-age=1200, public")).toBe(1200);
    expect(parseProfileCacheMaxAge("public")).toBe(DEFAULT_PROFILE_CACHE_TTL_SECONDS);
    expect(parseProfileCacheMaxAge("max-age=soon")).toBe(DEFAULT_PROFILE_CACHE_TTL_SECONDS);
    expect(parseProfileCacheMaxAge()).toBe(DEFAULT_PROFILE_CACHE_TTL_SECONDS);
  });

  test("builds profile cache entries with refresh metadata", () => {
    const entry = createProfileCacheEntry({
      accountId: " wf-123 ",
      cacheControl: "public, max-age=90",
      fetchedAt: "2026-05-11T12:00:00.000Z",
      jsonText: "{\"Results\":[{}]}",
      platformKey: " PC ",
    });

    expect(entry).toEqual({
      accountId: "wf-123",
      cacheControl: "public, max-age=90",
      expiresAt: "2026-05-11T12:15:00.000Z",
      fetchedAt: "2026-05-11T12:00:00.000Z",
      jsonText: "{\"Results\":[{}]}",
      nextRefreshAt: "2026-05-11T12:15:00.000Z",
      platformKey: "pc",
    });
    expect(isProfileCacheEntryFresh(entry, new Date("2026-05-11T12:14:59.000Z"))).toBe(true);
    expect(isProfileCacheEntryFresh(entry, new Date("2026-05-11T12:15:00.000Z"))).toBe(false);
  });

  test("separates profile cache keys by account and platform", () => {
    expect(buildProfileCacheKey("wf-123", "pc")).toBe("pc:wf-123");
    expect(buildProfileCacheKey("wf-123", "pc")).not.toBe(buildProfileCacheKey("wf-123", "ps4"));
    expect(buildProfileCacheKey("wf-123", "pc")).not.toBe(buildProfileCacheKey("wf-456", "pc"));
  });

  test("extracts display name and mastery rank from profile JSON", () => {
    expect(
      extractProfileSummary(JSON.stringify({ Results: [{ PlayerName: "Tenno", MasteryRank: 28 }] })),
    ).toEqual({
      displayName: "Tenno",
      masteryRank: 28,
    });
    expect(
      extractProfileSummary(JSON.stringify({ Results: [{ DisplayName: "Lotus", MasteryRank: "30" }] })),
    ).toEqual({
      displayName: "Lotus",
      masteryRank: 30,
    });
    expect(extractProfileSummary("{bad json")).toBeNull();
    expect(extractProfileSummary(JSON.stringify({ Results: [] }))).toBeNull();
  });
});

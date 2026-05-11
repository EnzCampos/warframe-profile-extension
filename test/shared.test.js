import { describe, expect, test } from "vitest";
import {
  DEFAULT_ALLOWED_ORIGINS,
  buildProfileUrl,
  isOriginAllowed,
  mapProfileFetchError,
  normalizeAllowedOrigins,
  normalizePlatformKey,
} from "../src/shared.js";

describe("extension core helpers", () => {
  test("normalizes and deduplicates trusted origins", () => {
    expect(
      normalizeAllowedOrigins([
        "https://example.com/path",
        "https://example.com/other",
        "bad-url",
        "http://localhost:3000/mastery",
      ]),
    ).toEqual(["http://localhost:3000", "https://example.com"]);
  });

  test("checks external consumer origins against the allowlist", () => {
    expect(
      isOriginAllowed("https://wftracker.vercel.app/mastery", DEFAULT_ALLOWED_ORIGINS),
    ).toBe(true);
    expect(
      isOriginAllowed("https://not-approved.example", DEFAULT_ALLOWED_ORIGINS),
    ).toBe(false);
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
});

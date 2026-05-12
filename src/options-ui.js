import {
  DEFAULT_ALLOWED_ORIGINS,
  PLATFORM_OPTIONS,
  STORAGE_KEYS,
  buildProfileCacheKey,
  extractProfileSummary,
  isProfileCacheEntryFor,
  normalizeAllowedOrigins,
  normalizePlatformKey,
  normalizeTrustedSiteInput,
} from "./shared.js";

const platformSelect = document.querySelector("#platform");
const accountIdInput = document.querySelector("#accountId");
const trustedSitesEl = document.querySelector("#trustedSites");
const siteInput = document.querySelector("#siteInput");
const addSiteButton = document.querySelector("#addSite");
const statusEl = document.querySelector("#status");
const saveButton = document.querySelector("#save");
const refreshButton = document.querySelector("#refreshGid");
const loadProfileButton = document.querySelector("#loadProfile");
const displayNameEl = document.querySelector("#displayName");
const masteryRankEl = document.querySelector("#masteryRank");
const profileMetaEl = document.querySelector("#profileMeta");

let trustedOrigins = [];

function setStatus(message, kind = "info") {
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
}

function renderPlatformOptions() {
  for (const platform of PLATFORM_OPTIONS) {
    const option = document.createElement("option");
    option.value = platform.key;
    option.textContent = platform.label;
    platformSelect.append(option);
  }
}

async function loadState() {
  const stored = await chrome.storage.sync.get([
    STORAGE_KEYS.accountId,
    STORAGE_KEYS.allowedOrigins,
    STORAGE_KEYS.platformKey,
  ]);
  const platformKey = normalizePlatformKey(stored[STORAGE_KEYS.platformKey]) ?? "";
  const allowedOrigins = normalizeAllowedOrigins(
    stored[STORAGE_KEYS.allowedOrigins] ?? DEFAULT_ALLOWED_ORIGINS,
  );

  platformSelect.value = platformKey;
  accountIdInput.value = stored[STORAGE_KEYS.accountId] ?? "";
  trustedOrigins = allowedOrigins;
  renderTrustedSites();
  await renderProfileSummary(accountIdInput.value, platformKey);
  updateLoadProfileButton();

  if (!platformKey) {
    setStatus("Choose your Warframe platform before syncing.", "warning");
  } else if (!accountIdInput.value) {
    setStatus("Log in to warframe.com, then refresh the gid.", "warning");
  } else {
    setStatus("Extension is ready.", "success");
  }
}

async function renderProfileSummary(accountId, platformKey) {
  setProfileSummaryEmpty("No synced profile yet.");

  const cacheKey = buildProfileCacheKey(accountId, platformKey);
  if (!cacheKey) {
    return;
  }

  const cachedEntry = await getProfileCacheEntry(cacheKey, accountId, platformKey);
  if (!cachedEntry) {
    return;
  }

  const summary = extractProfileSummary(cachedEntry.jsonText);
  if (!summary) {
    setProfileSummaryEmpty("Saved profile data is not readable.");
    return;
  }

  displayNameEl.textContent = summary.displayName || "Unknown";
  masteryRankEl.textContent = summary.masteryRank === null ? "--" : `MR ${summary.masteryRank}`;
  profileMetaEl.textContent = `Last synced ${formatDateTime(cachedEntry.fetchedAt)}`;
}

async function getProfileCacheEntry(cacheKey, accountId, platformKey) {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.profileCache);
    const cache = stored[STORAGE_KEYS.profileCache];
    const entry = cache && typeof cache === "object" && !Array.isArray(cache) ? cache[cacheKey] : null;
    return isProfileCacheEntryFor(entry, accountId, platformKey) ? entry : null;
  } catch {
    return null;
  }
}

function setProfileSummaryEmpty(message) {
  displayNameEl.textContent = "Not synced";
  masteryRankEl.textContent = "--";
  profileMetaEl.textContent = message;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "recently";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function saveState() {
  const platformKey = normalizePlatformKey(platformSelect.value);
  const values = {
    [STORAGE_KEYS.allowedOrigins]: trustedOrigins,
  };

  if (platformKey) {
    values[STORAGE_KEYS.platformKey] = platformKey;
  }

  await chrome.storage.sync.set(values);
  await chrome.action.setBadgeText({ text: "" });
  await renderProfileSummary(accountIdInput.value, platformKey);
  setStatus(platformKey ? "Saved." : "Trusted sites saved. Choose a platform before syncing.", "success");
  updateLoadProfileButton();
}

function renderTrustedSites() {
  trustedSitesEl.textContent = "";

  if (trustedOrigins.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "empty-state";
    emptyState.textContent = "No trusted sites yet.";
    trustedSitesEl.append(emptyState);
    return;
  }

  for (const origin of trustedOrigins) {
    const item = document.createElement("div");
    item.className = "trusted-site";

    const originText = document.createElement("span");
    originText.textContent = origin;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-site";
    removeButton.textContent = "Remove";
    removeButton.setAttribute("aria-label", `Remove ${origin}`);
    removeButton.addEventListener("click", () => removeTrustedSite(origin));

    item.append(originText, removeButton);
    trustedSitesEl.append(item);
  }
}

function addTrustedSite() {
  const origin = normalizeTrustedSiteInput(siteInput.value);

  if (!origin) {
    setStatus("Enter a valid site or URL.", "error");
    return;
  }

  if (trustedOrigins.includes(origin)) {
    setStatus("That site is already trusted.", "warning");
    siteInput.value = "";
    return;
  }

  trustedOrigins = normalizeAllowedOrigins([...trustedOrigins, origin]);
  siteInput.value = "";
  renderTrustedSites();
  setStatus("Trusted site added. Save to apply changes.", "info");
}

function removeTrustedSite(origin) {
  trustedOrigins = trustedOrigins.filter((trustedOrigin) => trustedOrigin !== origin);
  renderTrustedSites();
  setStatus("Trusted site removed. Save to apply changes.", "info");
}

async function refreshGid() {
  const response = await chrome.runtime.sendMessage({ type: "warframeProfile.captureGid" });
  if (!response?.ok || !response.accountIdPresent) {
    setStatus("No gid found. Log in to warframe.com first.", "warning");
    updateLoadProfileButton();
    return;
  }

  await loadState();
  setStatus("gid captured.", "success");
  updateLoadProfileButton();
}

function canLoadProfileData() {
  return Boolean(accountIdInput.value.trim() && normalizePlatformKey(platformSelect.value));
}

function updateLoadProfileButton() {
  loadProfileButton.disabled = !canLoadProfileData();
}

async function loadProfileData() {
  const accountId = accountIdInput.value.trim();
  const platformKey = normalizePlatformKey(platformSelect.value);

  if (!accountId) {
    setStatus("No gid found. Log in to warframe.com first.", "warning");
    updateLoadProfileButton();
    return;
  }

  if (!platformKey) {
    setStatus("Choose your Warframe platform before loading data.", "warning");
    updateLoadProfileButton();
    return;
  }

  loadProfileButton.disabled = true;
  setStatus("Loading profile data...", "info");

  try {
    const response = await chrome.runtime.sendMessage({
      accountId,
      platformKey,
      type: "warframeProfile.syncProfileInternal",
    });

    await renderProfileSummary(accountId, platformKey);

    if (!response?.ok) {
      setStatus(response?.error?.message ?? "There was an error loading profile data.", "error");
      return;
    }

    if (response.refreshError) {
      setStatus(`There was an error refreshing profile data: ${response.refreshError.message}`, "error");
      return;
    }

    setStatus(response.cached ? "Profile data loaded from cache. No error." : "Profile data loaded. No error.", "success");
  } catch {
    setStatus("There was an error loading profile data.", "error");
  } finally {
    updateLoadProfileButton();
  }
}

renderPlatformOptions();
void loadState();
addSiteButton.addEventListener("click", addTrustedSite);
siteInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addTrustedSite();
  }
});
saveButton.addEventListener("click", () => void saveState());
refreshButton.addEventListener("click", () => void refreshGid());
loadProfileButton.addEventListener("click", () => void loadProfileData());
platformSelect.addEventListener("change", () => {
  const platformKey = normalizePlatformKey(platformSelect.value);
  updateLoadProfileButton();
  void renderProfileSummary(accountIdInput.value, platformKey);
});

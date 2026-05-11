import {
  DEFAULT_ALLOWED_ORIGINS,
  PLATFORM_OPTIONS,
  STORAGE_KEYS,
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

  if (!platformKey) {
    setStatus("Choose your Warframe platform before syncing.", "warning");
  } else if (!accountIdInput.value) {
    setStatus("Log in to warframe.com, then refresh the gid.", "warning");
  } else {
    setStatus("Extension is ready.", "success");
  }
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
  setStatus(platformKey ? "Saved." : "Trusted sites saved. Choose a platform before syncing.", "success");
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
    return;
  }

  await loadState();
  setStatus("gid captured.", "success");
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

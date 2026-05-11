import {
  DEFAULT_ALLOWED_ORIGINS,
  PLATFORM_OPTIONS,
  STORAGE_KEYS,
  normalizeAllowedOrigins,
  normalizePlatformKey,
} from "./shared.js";

const platformSelect = document.querySelector("#platform");
const accountIdInput = document.querySelector("#accountId");
const allowlistInput = document.querySelector("#allowlist");
const statusEl = document.querySelector("#status");
const saveButton = document.querySelector("#save");
const refreshButton = document.querySelector("#refreshGid");

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
  allowlistInput.value = allowedOrigins.join("\n");

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
  const allowedOrigins = normalizeAllowedOrigins(allowlistInput.value.split(/\r?\n/));

  if (!platformKey) {
    setStatus("Choose a supported platform.", "error");
    return;
  }

  await chrome.storage.sync.set({
    [STORAGE_KEYS.allowedOrigins]: allowedOrigins,
    [STORAGE_KEYS.platformKey]: platformKey,
  });
  await chrome.action.setBadgeText({ text: "" });
  setStatus("Saved.", "success");
}

async function refreshGid() {
  const response = await chrome.runtime.sendMessage({ type: "wftracker.captureGid" });
  if (!response?.ok || !response.accountIdPresent) {
    setStatus("No gid found. Log in to warframe.com first.", "warning");
    return;
  }

  await loadState();
  setStatus("gid captured.", "success");
}

renderPlatformOptions();
void loadState();
saveButton.addEventListener("click", () => void saveState());
refreshButton.addEventListener("click", () => void refreshGid());

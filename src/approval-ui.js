import { normalizeOrigin } from "./shared.js";

const originEl = document.querySelector("#origin");
const statusEl = document.querySelector("#status");
const approveButton = document.querySelector("#approve");
const refuseButton = document.querySelector("#refuse");

const params = new URLSearchParams(window.location.search);
const origin = normalizeOrigin(params.get("origin") ?? "");

if (origin) {
  originEl.textContent = origin;
} else {
  originEl.textContent = "Unknown site";
  approveButton.disabled = true;
  setStatus("This approval request is invalid.", "error");
}

function setStatus(message, kind = "info") {
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
}

async function decide(approved) {
  if (!origin) {
    return;
  }

  approveButton.disabled = true;
  refuseButton.disabled = true;
  setStatus(approved ? "Approving..." : "Refusing...");

  try {
    const response = await chrome.runtime.sendMessage({
      approved,
      origin,
      type: "warframeProfile.approvalDecision",
    });

    if (!response?.ok) {
      setStatus("This request is no longer active.", "warning");
      return;
    }

    window.close();
  } catch {
    setStatus("The approval request could not be completed.", "error");
    approveButton.disabled = false;
    refuseButton.disabled = false;
  }
}

approveButton.addEventListener("click", () => void decide(true));
refuseButton.addEventListener("click", () => void decide(false));

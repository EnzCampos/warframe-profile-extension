const PAGE_REQUEST_SOURCE = "warframe-profile-extension-page";
const EXTENSION_RESPONSE_SOURCE = "warframe-profile-extension";

let approvalModalPromise = null;

if (window.location.hostname === "www.warframe.com") {
  try {
    const result = chrome.runtime.sendMessage({ type: "warframeProfile.captureGid" });
    if (result && typeof result.catch === "function") {
      result.catch(() => undefined);
    }
  } catch {
    // The background service worker may be waking up; the popup/status request
    // will attempt cookie capture again.
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window || !isPageRequest(event.data)) {
    return;
  }

  const { requestId, message } = event.data;

  void handlePageRequest(requestId, message);
});

function isPageRequest(data) {
  return (
    data?.source === PAGE_REQUEST_SOURCE &&
    data.type === "warframeProfile.request" &&
    typeof data.requestId === "string" &&
    typeof data.message?.type === "string"
  );
}

async function handlePageRequest(requestId, message) {
  try {
    if (requiresProfileApproval(message?.type)) {
      const approved = await ensurePageOriginTrusted();
      if (!approved) {
        postResponse(requestId, createError("origin_not_allowed", "This website is not allowed to request Warframe profile data."));
        return;
      }
    }

    const response = await chrome.runtime.sendMessage({
      origin: window.location.origin,
      payload: message,
      type: "warframeProfile.forwardExternal",
    });
    postResponse(requestId, response);
  } catch {
    postResponse(requestId, createError("extension_unavailable", "Warframe Profile Extension is not available."));
  }
}

function requiresProfileApproval(type) {
  return type === "warframeProfile.getIdentity" || type === "warframeProfile.syncProfile";
}

async function ensurePageOriginTrusted() {
  const status = await chrome.runtime.sendMessage({
    origin: window.location.origin,
    payload: { type: "warframeProfile.status" },
    type: "warframeProfile.forwardExternal",
  });

  if (status?.allowedOrigin) {
    return true;
  }

  approvalModalPromise ??= showApprovalModal(window.location.origin).finally(() => {
    approvalModalPromise = null;
  });
  const approved = await approvalModalPromise;
  if (!approved) {
    return false;
  }

  const response = await chrome.runtime.sendMessage({
    origin: window.location.origin,
    type: "warframeProfile.trustOrigin",
  });

  return Boolean(response?.ok);
}

function postResponse(requestId, response) {
  window.postMessage(
    {
      requestId,
      response,
      source: EXTENSION_RESPONSE_SOURCE,
      type: "warframeProfile.response",
    },
    window.location.origin,
  );
}

function createError(code, message) {
  return {
    error: {
      code,
      message,
    },
    ok: false,
  };
}

function showApprovalModal(origin) {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        color-scheme: dark;
        font-family: Arial, sans-serif;
      }

      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        background: rgba(3, 7, 12, 0.66);
      }

      .dialog {
        box-sizing: border-box;
        width: min(420px, calc(100vw - 32px));
        border: 1px solid rgba(226, 198, 122, 0.42);
        border-radius: 8px;
        background: #08101a;
        color: #f5f5f2;
        box-shadow: 0 20px 70px rgba(0, 0, 0, 0.45);
        padding: 18px;
      }

      h2 {
        margin: 0 0 8px;
        color: #f5f5f2;
        font-size: 20px;
        line-height: 1.2;
      }

      p {
        margin: 0;
        color: #aeb4bd;
        font-size: 14px;
        line-height: 1.45;
      }

      .origin {
        overflow-wrap: anywhere;
        margin: 14px 0;
        border: 1px solid rgba(112, 129, 150, 0.55);
        border-radius: 8px;
        background: rgba(9, 18, 29, 0.88);
        color: #f5f5f2;
        font-size: 14px;
        padding: 12px;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }

      button {
        border: 1px solid #e2c67a;
        border-radius: 8px;
        background: #c8a84b;
        color: #101010;
        cursor: pointer;
        font: inherit;
        font-weight: 800;
        padding: 10px 14px;
      }

      button[data-action="refuse"] {
        background: transparent;
        color: #e2c67a;
      }
    `;

    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";

    const dialog = document.createElement("section");
    dialog.className = "dialog";
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("role", "dialog");

    const title = document.createElement("h2");
    title.textContent = "Approve profile access?";

    const description = document.createElement("p");
    description.textContent = "This site wants to request your Warframe profile data through the extension.";

    const originEl = document.createElement("div");
    originEl.className = "origin";
    originEl.textContent = origin;

    const actions = document.createElement("div");
    actions.className = "actions";

    const refuseButton = document.createElement("button");
    refuseButton.type = "button";
    refuseButton.dataset.action = "refuse";
    refuseButton.textContent = "Refuse";

    const approveButton = document.createElement("button");
    approveButton.type = "button";
    approveButton.textContent = "Approve";

    actions.append(refuseButton, approveButton);
    dialog.append(title, description, originEl, actions);
    backdrop.append(dialog);
    shadow.append(style, backdrop);
    document.documentElement.append(host);

    let settled = false;
    const finish = (approved) => {
      if (settled) {
        return;
      }

      settled = true;
      host.remove();
      resolve(approved);
    };

    refuseButton.addEventListener("click", () => finish(false));
    approveButton.addEventListener("click", () => finish(true));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        finish(false);
      }
    });
    shadow.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        finish(false);
      }
    });
    approveButton.focus();
  });
}

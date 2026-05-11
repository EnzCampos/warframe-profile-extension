const PAGE_REQUEST_SOURCE = "warframe-profile-extension-page";
const EXTENSION_RESPONSE_SOURCE = "warframe-profile-extension";

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

  void chrome.runtime
    .sendMessage({
      origin: window.location.origin,
      payload: message,
      type: "warframeProfile.forwardExternal",
    })
    .then((response) => {
      window.postMessage(
        {
          requestId,
          response,
          source: EXTENSION_RESPONSE_SOURCE,
          type: "warframeProfile.response",
        },
        window.location.origin,
      );
    })
    .catch(() => {
      window.postMessage(
        {
          requestId,
          response: {
            error: {
              code: "extension_unavailable",
              message: "Warframe Profile Extension is not available.",
            },
            ok: false,
          },
          source: EXTENSION_RESPONSE_SOURCE,
          type: "warframeProfile.response",
        },
        window.location.origin,
      );
    });
});

function isPageRequest(data) {
  return (
    data?.source === PAGE_REQUEST_SOURCE &&
    data.type === "warframeProfile.request" &&
    typeof data.requestId === "string" &&
    typeof data.message?.type === "string"
  );
}

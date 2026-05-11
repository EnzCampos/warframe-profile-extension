try {
  const result = chrome.runtime.sendMessage({ type: "wftracker.captureGid" });
  if (result && typeof result.catch === "function") {
    result.catch(() => undefined);
  }
} catch {
  // The background service worker may be waking up; the popup/status request
  // will attempt cookie capture again.
}

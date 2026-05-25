# Warframe Profile Extension

Open source browser extension that captures the signed-in Warframe `gid` cookie, stores a selected platform, and lets approved web origins request Warframe public profile data through the extension.

Warframe Profile Extension was made for Warframe Tracker at `https://wf-tracker.com`.

## Features

- Captures the Warframe account `gid` from `warframe.com`.
- Supports PC, PlayStation, Xbox, Switch, iOS, and Android profile endpoints.
- Prompts before trusting a new site that requests profile data through the extension bridge.
- Exposes status, identity, and profile sync messages to approved external consumers.

## Requirements

- Node.js 18 or newer.
- A Chromium-compatible browser for loading the unpacked extension.

## Setup

```powershell
npm install
npm test
```

## Build

Compile the extension into a clean distributable folder and zip archive:

```powershell
npm run build
```

The build output is written to `dist/`, including a versioned extension zip.

For CI parity, run:

```powershell
npm run ci
```

## Loading the extension

1. Open the browser extensions page.
2. Enable developer mode.
3. Choose the option to load an unpacked extension.
4. Select this project folder during development, or `dist/` after running `npm run build`.
5. Log in to `https://www.warframe.com/`.
6. Open the extension options page, choose your platform, refresh the `gid`, add any trusted sites, and save.

## Development

- Main extension metadata lives in `manifest.json`.
- Shared platform and URL helpers live in `src/shared.js`.
- The background service worker handles cookie capture, origin checks, and profile fetches in `src/background.js`.
- The content script exposes the page bridge on normal webpages and captures the Warframe `gid` on `warframe.com`.
- The options and popup screens use `options.html`, `popup.html`, `src/options-ui.js`, and `src/options.css`.

Run tests before submitting changes:

```powershell
npm test
```

## CI/CD

GitHub Actions runs tests and builds the extension zip on pushes to `main`, pull requests, and manual workflow runs.

Pushes to `main` and manual workflow runs also upload the built zip to the Chrome Web Store and submit it for review. Pull requests only test and build.

Configure these repository or `chrome-web-store` environment secrets before publishing:

- `CHROME_WEB_STORE_CLIENT_ID`
- `CHROME_WEB_STORE_CLIENT_SECRET`
- `CHROME_WEB_STORE_REFRESH_TOKEN`
- `CHROME_WEB_STORE_PUBLISHER_ID`
- `CHROME_WEB_STORE_EXTENSION_ID`

The Chrome Web Store item must already be created and published at least once from the Developer Dashboard with the intended visibility settings. The manifest version must be incremented before each store upload.

## External message types

Approved origins may use these message types:

- `warframeProfile.status`
- `warframeProfile.getIdentity`
- `warframeProfile.syncProfile`

`warframeProfile.syncProfile` returns the raw Warframe profile payload as `jsonText`. Successful responses also include cache metadata:

- `cached`: `true` when the profile came from extension storage instead of a new Warframe request.
- `stale`: `true` when the saved profile was returned after a failed refresh attempt.
- `fetchedAt`, `expiresAt`, and `nextRefreshAt`: ISO timestamps derived from the Warframe response cache headers.
- `refreshError`: present only on stale fallback responses, with the refresh failure code and message.

The trusted-site list starts empty. When a new site requests identity or profile sync data, the extension asks the user to approve or refuse that origin. Approved origins are saved and can be removed in the popup or options page.

Webpages can use the bridge with `window.postMessage`:

```js
const requestId = crypto.randomUUID();

window.postMessage(
  {
    message: { type: "warframeProfile.status" },
    requestId,
    source: "warframe-profile-extension-page",
    type: "warframeProfile.request",
  },
  window.location.origin,
);

window.addEventListener("message", (event) => {
  if (
    event.origin === window.location.origin &&
    event.data?.source === "warframe-profile-extension" &&
    event.data.requestId === requestId
  ) {
    console.log(event.data.response);
  }
});
```

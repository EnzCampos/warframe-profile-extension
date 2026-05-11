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

The build output is written to `dist/`, including `dist/warframe-profile-extension-0.1.0.zip`.

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

Manual workflow runs also execute a Chrome Web Store publishing placeholder job. The project can be published to the Chrome Web Store later by replacing that placeholder with the Chrome Web Store upload/publish step and configuring the required store credentials as repository secrets.

## External message types

Approved origins may use these message types:

- `warframeProfile.status`
- `warframeProfile.getIdentity`
- `warframeProfile.syncProfile`

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

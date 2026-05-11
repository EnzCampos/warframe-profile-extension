# Warframe Profile Extension

Browser extension that captures the signed-in Warframe `gid` cookie, stores a selected platform, and lets approved web origins request Warframe public profile data through the extension.

## Features

- Captures the Warframe account `gid` from `warframe.com`.
- Supports PC, PlayStation, Xbox, Switch, iOS, and Android profile endpoints.
- Lets users manage trusted origins that may request profile data.
- Exposes status, identity, and profile sync messages to approved external consumers.

## Requirements

- Node.js 18 or newer.
- A Chromium-compatible browser for loading the unpacked extension.

## Setup

```powershell
npm install
npm test
```

## Loading the extension

1. Open the browser extensions page.
2. Enable developer mode.
3. Choose the option to load an unpacked extension.
4. Select this project folder.
5. Log in to `https://www.warframe.com/`.
6. Open the extension options page, choose your platform, refresh the `gid`, and save.

## Development

- Main extension metadata lives in `manifest.json`.
- Shared platform and URL helpers live in `src/shared.js`.
- The background service worker handles cookie capture, allowlist checks, and profile fetches in `src/background.js`.
- The options and popup screens use `options.html`, `popup.html`, `src/options-ui.js`, and `src/options.css`.

Run tests before submitting changes:

```powershell
npm test
```

## External message types

Approved origins may use these message types:

- `wftracker.status`
- `wftracker.getIdentity`
- `wftracker.syncProfile`

The `wftracker.*` message names are part of the integration contract and are kept stable even though the extension display name is Warframe Profile Extension.

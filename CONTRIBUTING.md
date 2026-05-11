# Contributing

Thanks for helping improve Warframe Profile Extension.

## Local workflow

1. Install dependencies with `npm install`.
2. Make focused changes.
3. Run `npm run ci`.
4. Load the extension unpacked in a Chromium-compatible browser for manual checks when changing extension behavior or UI.

## Code guidelines

- Keep changes small and scoped to the behavior being updated.
- Preserve the `warframeProfile.*` external message types unless a coordinated breaking change is required.
- Add or update tests for shared helper behavior.
- Keep user-facing copy clear and consistent with the Warframe Profile Extension name.
- Do not commit generated dependency folders such as `node_modules/`.
- Do not commit generated build output from `dist/`.

## Manual testing checklist

- The extension loads without manifest errors.
- The options page can save a platform and trusted sites.
- The `gid` refresh flow works after logging in to `warframe.com`.
- Webpages can request status through the page bridge.
- New profile-data requests from untrusted sites open the approval popup.
- Refused or untrusted origins receive an `origin_not_allowed` response.

## Pull requests

Include a short summary, the tests you ran, and any manual browser checks that apply.

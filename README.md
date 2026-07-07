# Font Awesome Search — Raycast Extension

Quick, lightweight search of **Font Awesome Pro** icons (Classic family, **Regular** style)
straight from Raycast. Type a name or alias, then copy the icon name or its SVG.

## Features

- Live search across icon names **and aliases** via the Font Awesome GraphQL API.
- Restricted to the **Classic / Regular** style — icons without that variant are hidden.
- Themed icon previews in the results list.
- Actions per icon:
  - **Copy Name** — bare id, e.g. `user` (default, ⏎)
  - **Copy SVG** — full `<svg>` markup (⌘⇧C)
  - **Copy CSS Class** — `fa-regular fa-user` (⌘.)
  - **Copy Unicode** — `\f007` (⌘U)
  - **Paste Name** — paste the id into the frontmost app
  - **Open on fontawesome.com**

## Setup

1. Get an **API token**: [fontawesome.com/account/general](https://fontawesome.com/account/general)
   → *API Tokens*. A Pro plan is required for Pro icons.
2. Run the **Search Icons** command. On first launch Raycast prompts for the token
   (stored securely as a password preference).

The token is exchanged at runtime for a short-lived access token
(`POST https://api.fontawesome.com/token`), which is cached locally until it expires.
Your API token never leaves your machine except to talk to Font Awesome.

## Development

```bash
npm install
npm run dev      # ray develop — opens the command in Raycast
npm run build    # ray build
npm run lint     # ray lint
```

Requires the [Raycast](https://raycast.com) app and Node 20+.

## How it works

- `src/fontawesome.ts` — token exchange, access-token + version caching (in `LocalStorage`),
  and the GraphQL `search` query filtered to `family: CLASSIC, style: REGULAR`.
- `src/search-icons.tsx` — the debounced list view and copy/paste actions.

The search `version` is resolved from `release(version: "latest")` and cached for a day,
so results track the newest Font Awesome release automatically.

## Notes

- `assets/extension-icon.png` is a placeholder — swap it before publishing to the Raycast Store.
- Free (non-Pro) tokens work too, but only return the smaller set of free Classic/Regular icons.

## License

MIT

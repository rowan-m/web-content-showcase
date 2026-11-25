# Web Content Showcase

Config-driven static slideshow and playlist router for wall displays and digital signage.

## How it works

Configuration lives in five flat YAML files under `config/`. On every push to `main` and once each weekday morning (`07:00 UTC`), GitHub Actions resolves YouTube channel feeds, RSS/Atom feeds, and URL embed headers into a static `manifest.json` and deploys the site.

### Display routes

| Route | Purpose |
|---|---|
| `/?group=<name>` | **In-page slideshow player** for YouTube videos/Shorts (muted autoplay, English captions, automatic advance on video end), 1080p RSS summary cards with QR codes, and embeddable web pages. |
| `/next/?group=<name>` | **Persistent `localStorage` router** for display schedulers that rotate through sites blocking `<iframe>` embedding (`X-Frame-Options` / `frame-ancestors`). Each visit advances the cursor (or picks a non-repeating random item with `&order=random`) and either redirects via `window.location.replace` or renders cards/embeds/videos on-origin. |
| `/preview/` | **Contributor preview** listing every group, resolved items, display modes, and ready-to-paste playlist snippets. |

Keyboard shortcuts on `/`: `→` / `Space` (next), `←` (previous), `P` (pause/resume), `I` (toggle status HUD). Add `&hud=1` to show controls on load.

## Editing content via PR

Each content type has its own file under `config/`:

- **`config/settings.yaml`** — Default dwell time (`40s`), default group, and YouTube player options (`mute`, `captions`, `captionLang`, `controls`, `maxDuration: 5m`).
- **`config/youtube.yaml`** — Recent channel videos (`kind: videos`), recent Shorts (`kind: shorts`), and curated video lists (supports bare IDs, full URLs, or `{ id, start, end, maxDuration }`). Set `maxDuration: false` (or e.g. `10m`) per source or per video to override the global cap.
- **`config/feeds.yaml`** — RSS 2.0 and Atom feeds. Set `display: card` for 1080p summary slides with QR codes, or `display: redirect` to open the live article URL via `/next/`.
- **`config/urls.yaml`** — Explicit web URLs with optional `title`, `duration`, and `display: auto | iframe | redirect`.
- **`config/groups.yaml`** — Named display playlists (for example, separating quiet text/web groups from video groups) with `order: sequential | random`, optional `maxVideoDuration` override, wildcards (`*`, `youtube:*`, `feeds:*`, `urls:*`), and `exclude` lists (accepting source IDs, wildcards, or other group names).

Video length cap precedence (highest to lowest): `?maxVideo=` URL param (`10m`, `300s`, or `none`/`0` for full length) → per-video `maxDuration` → per-source `maxDuration` → per-group `maxVideoDuration` → `settings.yaml` `youtube.maxDuration` (`5m`).

Every PR runs schema validation, unit tests, live YouTube/feed checks, and an `X-Frame-Options` / CSP `frame-ancestors` check that catches URLs explicitly marked `display: iframe` when the target blocks framing.

## Local development

```bash
npm install
npm run validate:live
npm run build:manifest
npm run dev
```

Run tests and production build:

```bash
npm test
npm run build
npm run preview
```

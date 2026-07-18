# CLAUDE.md

Guidance for working in this repo. Covers the non-obvious things; the rest is in
the code and `README.md`.

## What this is

Two HACS custom Lovelace cards for the IKEA **ALPSTUGA** (Matter air quality
sensor, E2495), in one repo:

- `alpstuga-card` — current value of every metric (Air Quality, CO₂, PM2.5,
  temperature, humidity) in a compact tile layout.
- `alpstuga-card-advanced` — the same plus 24h history (air-quality timeline +
  per-metric sparklines).

Vanilla JS custom elements, **no build step** — the `.js` files are served to
the browser as-is (ES modules).

## Files

- `index.js` — HACS entry point. Imports both cards, so registering this one
  resource makes both available. `hacs.json` `filename` points here.
- `alpstuga-card.js` / `alpstuga-card-advanced.js` — each holds the card, its
  graphical config editor, and its `window.customCards` picker registration.
- `translations.js` — `t(hass, key, vars)`. EN + DE. Language comes from
  `hass.locale.language` → `hass.language` → `"en"`; falls back full-locale →
  base → English → the key. Add a language by copying the `en` block.
- `guidelines.js` — level→color thresholds per named profile. The `guidelines:`
  config option selects one (`who` default, `none` to disable). Add a standard
  as a new entry in `GUIDELINE_PROFILES` — no card changes needed.
- `demo/` — offline showcase (no HA needed). `harness.js` stubs `ha-card` /
  `ha-icon` and builds mock `hass`; `index.html` → `preview.png` (header),
  `features.html` → `features.png` (guideline-color showcase).

## Conventions & gotchas

- **No test/lint tooling.** Sanity-check edited JS with `node --check <file>`.
- **Version is duplicated:** `CARD_VERSION` in *both* card files — keep in sync.
- **All user-facing strings go through `t()`** (see `translations.js`), not
  hardcoded literals. Exceptions: `setConfig` errors (thrown before `hass`
  exists) and the `window.customCards` picker name/description.
- **Guideline coloring:** which metrics get tinted and how is decided in
  `guidelines.js`, not in the cards. Temperature/humidity use a bidirectional
  comfort model; CO₂/PM2.5 are monotonic bounds.
- **SVG sparkline tint:** set colors via inline `.style.stroke` / `.style.fill`,
  never `setAttribute("stroke", …)` — presentation attributes lose to the
  `.spark-*` CSS rules, so the tint wouldn't show.
- **American English** in docs and comments.

## Regenerating the demo images

Needs `python3` + Chromium/Chrome + internet (icons/fonts load from a CDN):

```bash
./demo/screenshot.sh   # writes demo/preview.png and demo/features.png
```

## Cutting a release

HACS serves whatever the latest git tag / GitHub release points to. Steps
(consistent with prior releases):

1. Bump `CARD_VERSION` to `X.Y.Z` in both card files; commit `Set version to X.Y.Z`.
2. Signed, annotated tag on that commit: `git tag -s vX.Y.Z -m vX.Y.Z`
   (`tag.gpgsign` is enabled globally). Push: `git push origin vX.Y.Z`.
3. `gh release create vX.Y.Z --title "vX.Y.Z — <short desc>" --verify-tag --notes …`
   Keep the `0.x — not yet stable` callout and New / Changed / Install sections.

Note in release notes when the HACS entry filename changes — **manual** installs
must update their resource URL (HACS installs update automatically).

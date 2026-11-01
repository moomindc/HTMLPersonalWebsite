# couchsurfer.co.uk — site guide

Static personal site (no build step), deployed from this folder (git remote: moomindc/HTMLPersonalWebsite). Brutalist / pop-art style. `../Brutal_Template/` holds the original page templates for reference.

## Preview
Pages fetch JSON, so they must be served over http (double-clicking shows an error):

    python -m http.server 8765   # then open http://localhost:8765/

## Files
- `index.html` — hero, featured projects (3), Now section. `about.html` (Contact), `writing.html`, `projects.html`.
- `now.html` — redirect to `index.html#now` only. There is no Now tab.
- `projects.js` / `projects.css` — project cards, filters, random colour + squiggle. Shared by index and projects pages.
- `now.js` / `now.css` / `now/` — Now section, driven by JSON (see "Updating Now").
- `page-*.html` and `shared-css.css` — unused template copies.
- Each page keeps its own inline CSS for header/footer/hero; keep new nav/footer changes consistent across pages.

## Style conventions
- CSS variables on `:root` (`--ink --bg --bg2 --red --ochre --slate --sage`); `.dark` class on body and html for dark mode.
- Dotted fills via `.bd-o` (ochre), `.bd-r` (red), `.bd-s` (slate), `.bd-g` (sage), `.bd-raw`. 3px borders, hard offset shadows, Space Grotesk + JetBrains Mono.
- Nav order: Projects (`n1`), Writing (`n2`), Contact (`n5`).

## Adding a project
1. Create `projects/<id>.json` (id: lowercase letters, digits, hyphens).
2. Add `<id>` to `projects/index.json`.
3. Optional image goes in `images/projects/`.

```json
{
  "name": "...", "description": "...", "date": "2026-03", "version": "1.0",
  "language": "Python", "status": "in-progress",
  "featured": 1,
  "links": [{ "label": "Live demo", "url": "https://..." }],
  "image": { "file": "icon.png", "alt": "...", "placement": "behind" }
}
```
- Required: `name description date version language status`. `date` is YYYY, YYYY-MM or YYYY-MM-DD. `status` is `complete` or `in-progress`. `language` may be a list.
- Optional: `featured` (1–3, shown on the home page in that order), `links` (full http/https URLs, or a file you host under `downloads/`, e.g. `"url": "downloads/ClipMonster-1.0-win64.zip"`), `image` (`placement`: `behind` or `inline`, default `inline`; `alt` required).
  A link may also be `"url": "<folder>/index.html"` to open a project page hosted in this site (same tab).
- Filters (Language, Status) are generated from the files. Projects page sorts newest first. Invalid files are skipped with a console warning.

## Updating Now
1. Create `now/YYYY-MM.json` (e.g. `now/2026-07.json`).
2. Add `"2026-07"` to `now/index.json`. The newest month is shown in full; the others appear under "Previous months". The month heading comes from the filename.

```json
{
  "subtitle": "What I'm up to",
  "items": [
    { "key": "Building", "style": "raw", "list": ["thing one", "thing two"] },
    { "key": "Travel", "style": "slate", "text": "Next trip: Belgium" }
  ]
}
```
- `subtitle` optional. 1–12 `items`; each needs `key` and either `text` (one line) or `list` (up to 10 strings).
- `style` (optional, default `raw`): `raw`, `ink`, `slate`, `ochre`, `sage`.
- Invalid files are skipped with a console warning.

## Rules
- Render external data with `textContent` / DOM APIs, never `innerHTML`. Validate URLs (http/https) and image filenames. Add `rel="noopener noreferrer"` to links opened in a new tab.
- Don't hotlink images or scripts from third parties; fonts are the only external resource.
- Keep descriptions in the owner's wording; don't silently "fix" copy.

- Cached assets: when you change `now.js`, `projects.js` or the CSS files, bump the `?v=` number on their `<script>`/`<link>` tags in `index.html` and `projects.html`.

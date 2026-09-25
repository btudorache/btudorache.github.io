# btudorache.github.io

Personal site. Plain HTML, CSS and ES modules, no build step; GitHub Pages serves
the `main` branch as-is (`.nojekyll`).

The owl at the top folds itself from a square of paper, one crease at a time:

- `owl-model.js` — the fold model: the crease sequence, the geometry it produces, and
  the crease pattern it leaves on the sheet. No three.js, so Node can run it too.
- `owl.js` — renders the model with three.js.
- `paper.js` — the paper material and lamp every scene shares.
- `drift.js` — the creased scraps drifting behind the page.
- `glyphs.js` — the four paper objects on the interest cards.
- `main.js` — boots all of the above; each piece falls back to plain HTML/SVG on its own.

## Running it

```sh
python -m http.server 8000
```

then open http://localhost:8000. Modules need a server; `file://` won't load them.

Debug parameters: `?fold=<t>` freezes the owl at stage `t` (0–11), `?curl=<k>`
scales the wing curl.

## After changing things

- **Any module:** bump `v=` in the import map in `index.html` (and on `style.css`,
  `site.js`, `main.js` there), so browsers drop their cached copies.
- **The fold model:** `node tools/owl-svg.mjs` redraws the flat owl in `index.html`,
  shown without WebGL.
- **The social preview:** serve the repo, open `/tools/og.html` in a 1200×630 window,
  and save a screenshot as `assets/og.png`.

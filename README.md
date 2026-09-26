# btudorache.github.io

Personal site. Plain HTML, CSS and ES modules, no build step; GitHub Pages serves
the `main` branch as-is (`.nojekyll`).

The owl at the top is Román Díaz's "Búho" (*Origami Essence*, 2009, p. 17). It folds
itself from a square of paper, yellow on one side and charcoal on the other, step by
step from his diagrams:

- `fold.js` — the folding engine: simple folds, compound ones (reverse folds, slides,
  pleats) and a final shaping stage, plus `validate()`, which checks that every flat
  state is one real paper can take. No three.js, so Node can run it too.
- `owl-model.js` — the owl: its crease sequence, with the reasoning behind each step,
  and the crease pattern it leaves on the sheet.
- `owl.js` — renders the model with three.js.
- `paper.js` — the paper material and lamp every scene shares.
- `drift.js` — the creased scraps drifting behind the page.
- `glyphs.js` — the small objects on the interest cards: the owl's crease pattern,
  a lotus, a chip and a book.
- `main.js` — boots all of the above; each piece falls back to plain HTML/SVG on its own.

## Running it

```sh
python -m http.server 8000
```

then open http://localhost:8000. Modules need a server; `file://` won't load them.

Debug parameter: `?fold=<t>` freezes the owl at stage `t` (0 to the number of stages
in `owl-model.js`; fractions show a fold part-way).

## After changing things

- **Any module:** bump `v=` in the import map in `index.html` (and on `style.css`,
  `site.js`, `main.js` there), so browsers drop their cached copies.
- **The fold model:** `node tools/owl-svg.mjs` redraws the flat owl in `index.html`,
  shown without WebGL. `python tools/check-owl.py <your copy of the book>` scores the
  model against Díaz's drawings (the book is not in this repo; see the script).
- **The social preview:** serve the repo, open `/tools/og.html` in a 1200×630 window,
  and save a screenshot as `assets/og.png`.
- **The icons:** `favicon.ico` (16 and 32 px) and `assets/apple-touch-icon.png`
  (180 px, on the page's paper colour) are rendered from `assets/favicon.svg`.

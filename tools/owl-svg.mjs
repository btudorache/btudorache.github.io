// Draws the folded owl as a flat SVG, straight from the fold model, and writes it
// into index.html between the owl-svg markers. That SVG is what shows without
// WebGL (and while three.js is still loading on a slow connection), so it has to
// be the same owl the page folds. Rerun after changing owl-model.js:
//
//     node tools/owl-svg.mjs
//
// It draws the owl flat, as the last fold leaves it: the body's final curve needs depth.
// The paper's two colours come from style.css (--owl-front, --owl-back), so the drawing
// follows the page's light and dark themes.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { flatState } from '../fold.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const M = await import('../owl-model.js');

const model = M.buildModel({ tessellate: false });
const flat = M.stages.findIndex(st => st.shape);        // the owl as the last fold leaves it
const k = flat < 0 ? M.stages.length : flat;
const S = 1000;                                        // model units -> SVG units
const pt = ([x, y]) => `${Math.round(x * S)},${Math.round(-y * S)}`;

// painter's order, as the folder sees them, without the pieces that the ones above
// cover completely (sampled finely: a piece shows if any point inside it does)
const stack = flatState(model, k);
const inside = (pts, [x, y]) => {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
        if (Math.abs(c) < 1e-12) continue;
        if (s && Math.sign(c) !== s) return false;
        s = Math.sign(c);
    }
    return true;
};
const shows = i => {
    const pts = stack[i].pts, n = pts.length;
    const c = pts.reduce((m, q) => [m[0] + q[0] / n, m[1] + q[1] / n], [0, 0]);
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
    const samples = [c, ...pts.map(q => [q[0] + (c[0] - q[0]) * 0.02, q[1] + (c[1] - q[1]) * 0.02])];
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.002)
        for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.002) samples.push([x, y]);
    return samples.some(q => inside(pts, q) && !stack.slice(i + 1).some(o => inside(o.pts, q)));
};
const pieces = stack.filter((_, i) => shows(i));
const edgesOf = new Map();
for (const e of model.edges) {
    if (e.since >= k) continue;
    if (!edgesOf.has(e.pi)) edgesOf.set(e.pi, []);
    edgesOf.get(e.pi).push(e);
}

const all = pieces.flatMap(p => p.pts);
const pad = 0.02;
const minX = Math.min(...all.map(q => q[0])) - pad, maxX = Math.max(...all.map(q => q[0])) + pad;
const minY = Math.min(...all.map(q => q[1])) - pad, maxY = Math.max(...all.map(q => q[1])) + pad;
const vb = [minX * S, -maxY * S, (maxX - minX) * S, (maxY - minY) * S].map(Math.round).join(' ');

const out = [];
for (const pc of pieces) {
    out.push(`<polygon points="${pc.pts.map(pt).join(' ')}" class="${pc.side === 'front' ? 'f' : 'b'}"/>`);
    const pi = model.polys.indexOf(pc.poly), f = pc.pts;
    const lines = (edgesOf.get(pi) || []).map(e => `M${pt(f[e.i])}L${pt(f[e.j])}`).join('');
    if (lines) out.push(`<path d="${lines}"/>`);
}

// fills and strokes are styled by style.css (.owl-fallback)
const svg = `<svg class="owl-fallback" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="An origami owl, folded from a square of paper">` +
    out.join('') + '</svg>';

const file = root + 'index.html';
const html = readFileSync(file, 'utf8');
const eol = html.includes('\r\n') ? '\r\n' : '\n';     // keep the file's own line endings
const re = /(<!-- owl-svg:start[^>]*-->)[\s\S]*?(<!-- owl-svg:end -->)/;
if (!re.test(html)) throw new Error('owl-svg markers not found in index.html');
writeFileSync(file, html.replace(re, `$1${eol}                ${svg}${eol}                $2`));
console.log(`owl-svg: ${pieces.length} pieces, ${svg.length} bytes, viewBox ${vb}`);

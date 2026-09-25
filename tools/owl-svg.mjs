// Draws the folded owl as a flat SVG, straight from the fold model, and writes it
// into index.html between the owl-svg markers. That SVG is what shows without
// WebGL (and while three.js is still loading on a slow connection), so it has to
// be the same owl the page folds. Rerun after changing owl-model.js:
//
//     node tools/owl-svg.mjs
//
// The wings are drawn before their final curl: a flat drawing has no depth to curl into.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// owl-model.js is a browser module with no imports; load it as one, whatever
// module type Node would otherwise guess for a .js file here
const src = readFileSync(root + 'owl-model.js', 'utf8');
const M = await import('data:text/javascript,' + encodeURIComponent(src));

const { polys, edges } = M.buildModel({ tessellate: false });
const N = M.stages.length;
const S = 1000;                                        // model units -> SVG units
const pt = ([x, y]) => `${Math.round(x * S)},${Math.round(-y * S)}`;
const hex = c => '#' + c.toString(16).padStart(6, '0');

// the side of each piece that faces the viewer: every mirror flips the paper over
const flips = p => p.rec.filter(r => r.m).length;
const edgesOf = new Map();
for (const e of edges) {
    if (!edgesOf.has(e.pi)) edgesOf.set(e.pi, []);
    edgesOf.get(e.pi).push(e);
}

const all = polys.flatMap(p => p.fAt[N]);
const pad = 0.02;
const minX = Math.min(...all.map(q => q[0])) - pad, maxX = Math.max(...all.map(q => q[0])) + pad;
const minY = Math.min(...all.map(q => q[1])) - pad, maxY = Math.max(...all.map(q => q[1])) + pad;
const vb = [minX * S, -maxY * S, (maxX - minX) * S, (maxY - minY) * S].map(Math.round).join(' ');

// painter's order: lowest layer first
const order = polys.map((p, i) => i).sort((a, b) => polys[a].layer - polys[b].layer);
const out = [];
for (const i of order) {
    const p = polys[i], f = p.fAt[N];
    out.push(`<polygon points="${f.map(pt).join(' ')}" fill="${hex(flips(p) % 2 ? M.TERRACOTTA : M.CREAM)}"/>`);
    const lines = (edgesOf.get(i) || []).map(e => `M${pt(f[e.i])}L${pt(f[e.j])}`).join('');
    if (lines) out.push(`<path d="${lines}"/>`);
}

// the ink, where the texture puts it once the owl is finished
const r = M.EYE_R;
for (const [x, y] of M.EYES_FINAL) {
    out.push(`<circle cx="${Math.round(x * S)}" cy="${Math.round(-y * S)}" r="${Math.round(r * S)}" fill="${hex(M.INK)}"/>`);
    out.push(`<circle cx="${Math.round((x - 0.33 * r) * S)}" cy="${Math.round(-(y + 0.33 * r) * S)}" r="${Math.round(0.28 * r * S)}" fill="#fff"/>`);
}
out.push(`<polygon points="${M.BEAK_FINAL.map(pt).join(' ')}" fill="${hex(M.BEAK_INK)}" stroke="${hex(M.BEAK_INK)}" stroke-width="${Math.round(0.35 * r * S)}" stroke-linejoin="round"/>`);

// crease and outline paths are styled by style.css (.owl-fallback path)
const svg = `<svg class="owl-fallback" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="An origami owl, folded from a square of paper">` +
    out.join('') + '</svg>';

const file = root + 'index.html';
const html = readFileSync(file, 'utf8');
const eol = html.includes('\r\n') ? '\r\n' : '\n';     // keep the file's own line endings
const re = /(<!-- owl-svg:start[^>]*-->)[\s\S]*?(<!-- owl-svg:end -->)/;
if (!re.test(html)) throw new Error('owl-svg markers not found in index.html');
writeFileSync(file, html.replace(re, `$1${eol}                ${svg}${eol}                $2`));
console.log(`owl-svg: ${polys.length} pieces, ${svg.length} bytes, viewBox ${vb}`);

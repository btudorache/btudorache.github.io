// The fold model behind the owl: the crease sequence, the geometry it produces,
// and the crease pattern it leaves on the sheet. Pure geometry, no three.js, so the
// page, the interest glyphs and tools/owl-svg.mjs all fold the same owl.
//
// The model is the "Easy Origami Owl" from Origami Way
// (https://www.origamiway.com/easy-origami-owl/), chosen because every one of
// its steps is a plain valley fold of a free flap: fold the square in half into
// a triangle, roll the top layer's tip into a pleat, fold the crown down to make
// the beak, turn over, pleat each wing out, fold the feet, turn back. No squash,
// petal, sink or reverse folds and no cuts, so a hinge rig can do it honestly.
//
// Paper: two-colour, cream on the front and terracotta on the back, with the
// eyes printed on the cream side where the head pleat will show them (the
// tutorial draws them on at the end; ours come pre-printed).
//
// Engine: the sheet is a set of convex polygons. Each stage splits the polygons
// along its crease and mirrors the moving side; at render time the moving side is
// rotated about the crease by 0..180 degrees, and completed stages are replayed
// as mirrors. A stage may restrict itself to one flap (layer), which is only
// legitimate when that flap is free on the moving side of the crease; the stages
// below all satisfy that.

export const CREAM = 0xf8f1e4;
export const TERRACOTTA = 0xb85a36;
export const INK = 0x2b2721;
export const H = Math.SQRT1_2;   // half-diagonal: the square sits corner-up, so the
                                 // folded triangle has base y = 0 and apex y = H

// ---------- crease sequence (model coords, front side toward +z, y up) ----------

export const movedIn = (p, k) => p.moved.has(k);
const topLayer = p => movedIn(p, 0);   // the half folded up in step 1: the front layer

// Wing crease k1 (from the tutorial photos): from a point just off the base
// centre up to the shoulder, steep enough that the wing tip ends level with the head.
const K1_BASE = 0.06 * H, K1_DIR = [0.2547, 1];

export const stages = [
    // 1. fold the bottom corner up to the top: a triangle, two layers
    { name: 'fold in half',       a: [0, 0],          d: [1, 0],  toward: [0, -1], dur: 0.7 },
    // 2. fold the top layer's tip down (top layer only: its apex is a free corner)
    { name: 'tip down',           a: [0, 0.79 * H],   d: [1, 0],  toward: [0, 1],  filter: topLayer },
    // 3. fold the top layer down again along a lower crease: the head band
    { name: 'band',               a: [0, 0.69 * H],   d: [1, 0],  toward: [0, 1],  filter: topLayer },
    // 4. fold the crown (now a single layer) down so its point meets the band: the beak
    { name: 'crown',              a: [0, 0.845 * H],  d: [1, 0],  toward: [0, 1] },
    // 5. turn the paper over
    { name: 'turn over',          turn: true, dur: 0.45 },
    // 6-7. left wing: fold the corner in across the body, then fold it back out
    { name: 'left wing in',       a: [-K1_BASE, 0],   d: [-K1_DIR[0], K1_DIR[1]], toward: [-1, 0], back: true },
    { name: 'left wing out',      a: [0, 0],          d: [0, 1],  toward: [1, 0],  back: true, filter: p => movedIn(p, 5) },
    // 8-9. right wing, the same
    { name: 'right wing in',      a: [K1_BASE, 0],    d: [K1_DIR[0], K1_DIR[1]],  toward: [1, 0],  back: true },
    { name: 'right wing out',     a: [0, 0],          d: [0, 1],  toward: [-1, 0], back: true, filter: p => movedIn(p, 7) },
    // 10. fold the bottom edge up: the feet
    { name: 'feet',               a: [0, 0.06 * H],   d: [1, 0],  toward: [0, -1], back: true },
    // 11. turn back over
    { name: 'turn back',          turn: true, dur: 0.45 },
];

// Ink drawn on at the end (step 15 of the tutorial): two eyes and a beak on the
// cream band. Given in final model coords and mapped back to the sheet: the band
// is the front layer (mirrored by step 1) folded down by step 3.
const toSheet = ([x, y]) => [x, -(2 * 0.69 * H - y)];
export const EYES_FINAL = [[-0.1 * H, 0.64 * H], [0.1 * H, 0.64 * H]];
export const EYES = EYES_FINAL.map(toSheet);
export const EYE_R = 0.036 * H;
export const BEAK_FINAL = [[-0.03 * H, 0.625 * H], [0.03 * H, 0.625 * H], [0, 0.596 * H]];
export const BEAK = BEAK_FINAL.map(toSheet);
export const BEAK_INK = 0xa94f2e;

// Wing curl (step 14, "gently curl out the wings"): each wing bends as a cylinder
// about an axis through its lower corner at the body, leaning inward at the top,
// so the outer part comes forward and its tip settles slightly downward. Paper
// held inside the body stays flat (the bend fades in over WING_EDGE_FADE outside
// the body edge). The wing is tessellated into strips so the bend is smooth.
export const isWing = p => movedIn(p, 6) || movedIn(p, 8);      // the outer wing: bent by the curl
const isWingFlap = p => movedIn(p, 5) || movedIn(p, 7);         // the whole wing flap, pleat included
export const WING_AXIS_A = [0.056, 0.054];     // lower corner, right wing (mirror for left)
export const WING_AXIS_D = [-0.35, 1];         // axis direction, right wing
const WING_STRIP = 0.06;
export const WING_EDGE_FADE = [0.01, 0.10];
export const WING_KAPPA = 1.15;                // curvature at full curl
export const bodyEdgeX = y => K1_BASE + K1_DIR[0] * y;   // the k1 crease: body outline

// ---------- 2D helpers ----------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

function lineOf(def) {
    const len = Math.hypot(def.d[0], def.d[1]);
    const d = [def.d[0] / len, def.d[1] / len];
    let n = [-d[1], d[0]];
    if (def.toward && dot(sub(def.toward, def.a), n) < 0) n = [-n[0], -n[1]];
    const lift = Math.sign(d[0] * n[1] - d[1] * n[0]) * (def.back ? -1 : 1);
    return { a: def.a, d, n, sgn: lift, back: !!def.back };
}

export function mirror(f, L) {
    const q = sub(f, L.a);
    const par = dot(q, L.d);
    const px = q[0] - par * L.d[0], py = q[1] - par * L.d[1];
    return [L.a[0] + par * L.d[0] - px, L.a[1] + par * L.d[1] - py];
}

function centroid(poly) {
    let x = 0, y = 0;
    for (const v of poly.v) { x += v.f[0]; y += v.f[1]; }
    return [x / poly.v.length, y / poly.v.length];
}

function bbox(pts) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of pts) {
        b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]);
        b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]);
    }
    return b;
}
const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

// Split a convex polygon by a line. Vertices carry sheet coords (p) and flat coords (f).
function splitPoly(poly, L) {
    const T = 1e-7;
    const s = poly.v.map(v => dot(sub(v.f, L.a), L.n));
    if (s.every(x => x > -T) || s.every(x => x < T)) return [poly];
    const pos = [], neg = [];
    const n = poly.v.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, vi = poly.v[i], vj = poly.v[j], si = s[i], sj = s[j];
        if (si > T) pos.push(vi); else if (si < -T) neg.push(vi); else { pos.push(vi); neg.push(vi); }
        if ((si > T && sj < -T) || (si < -T && sj > T)) {
            const t = si / (si - sj);
            const nv = {
                p: [vi.p[0] + (vj.p[0] - vi.p[0]) * t, vi.p[1] + (vj.p[1] - vi.p[1]) * t],
                f: [vi.f[0] + (vj.f[0] - vi.f[0]) * t, vi.f[1] + (vj.f[1] - vi.f[1]) * t],
            };
            pos.push(nv); neg.push(nv);
        }
    }
    const mk = v => ({ v, layer: poly.layer, rec: poly.rec.slice(), moved: new Set(poly.moved) });
    return [mk(neg), mk(pos)].filter(q => q.v.length >= 3);
}

// ---------- build the fold model ----------

// `tessellate` cuts the wings into strips for the curl; flat uses (the fallback
// drawing, the crease pattern) leave it off.
export function buildModel({ tessellate = true } = {}) {
    const square = [[0, -H], [H, 0], [0, H], [-H, 0]];
    let polys = [{ v: square.map(p => ({ p, f: p.slice() })), layer: 0, rec: [], moved: new Set() }];

    const lines = stages.map(st => st.turn ? null : lineOf(st));
    stages.forEach((st, k) => {
        if (st.turn) {
            for (const p of polys) p.rec[k] = { m: false, lb: p.layer, la: p.layer };
            return;
        }
        const L = lines[k];
        polys = polys.flatMap(p => splitPoly(p, L));
        const movers = [], fixed = [];
        for (const p of polys) {
            const c = centroid(p);
            const onSide = dot(sub(c, L.a), L.n) > 0;
            (onSide && (!st.filter || st.filter(p, c)) ? movers : fixed).push(p);
        }
        const landing = bbox(movers.flatMap(p => p.v.map(v => mirror(v.f, L))));
        let below = -1, above = 1;
        for (const p of fixed) {
            if (overlaps(bbox(p.v.map(v => v.f)), landing)) {
                below = Math.max(below, p.layer);
                above = Math.min(above, p.layer);
            }
        }
        const top = Math.max(...movers.map(p => p.layer));
        const bottom = Math.min(...movers.map(p => p.layer));
        for (const p of fixed) p.rec[k] = { m: false, lb: p.layer, la: p.layer };
        for (const p of movers) {
            // a folded stack lands upside down: on top of the fixed layers for a
            // valley fold, underneath them for a mountain fold
            const la = L.back ? above - 1 - (p.layer - bottom) : below + 1 + (top - p.layer);
            p.rec[k] = { m: true, lb: p.layer, la };
            p.layer = la;
            p.moved.add(k);
            p.v = p.v.map(v => ({ p: v.p, f: mirror(v.f, L) }));
        }
    });

    // tessellate the wings into strips parallel to their curl axis
    for (const sx of tessellate ? [1, -1] : []) {
        const d = [sx * WING_AXIS_D[0], WING_AXIS_D[1]];
        const len = Math.hypot(d[0], d[1]);
        const n = [sx * d[1] / len, -sx * d[0] / len];       // outward normal
        for (let m = 1; m * WING_STRIP < 0.6; m++) {
            const a = [sx * WING_AXIS_A[0] + n[0] * m * WING_STRIP, WING_AXIS_A[1] + n[1] * m * WING_STRIP];
            const C = lineOf({ a, d });
            polys = polys.flatMap(p => isWingFlap(p) ? splitPoly(p, C) : [p]);
        }
        // and across the strips, so no piece is long enough to go visibly non-planar
        for (let m = -6; m <= 8; m++) {
            const a = [sx * WING_AXIS_A[0] + d[0] / len * m * WING_STRIP, WING_AXIS_A[1] + d[1] / len * m * WING_STRIP];
            const C = lineOf({ a, d: n });
            polys = polys.flatMap(p => isWingFlap(p) ? splitPoly(p, C) : [p]);
        }
    }

    // flat coordinates of every polygon before each stage
    for (const p of polys) {
        p.fAt = [p.v.map(v => v.p)];
        for (let k = 0; k < stages.length; k++) {
            const prev = p.fAt[k];
            p.fAt[k + 1] = p.rec[k].m ? prev.map(f => mirror(f, lines[k])) : prev;
        }
        // Fan-triangulate from a corner chosen by position, so the two paper layers
        // of a wing (identical polygons, possibly listed from different corners) get
        // the same triangles and stay parallel when bent.
        const fin = p.fAt[stages.length];
        p.hub = 0;
        for (let k = 1; k < fin.length; k++) {
            const a = fin[k], b = fin[p.hub];
            if (a[0] < b[0] - 1e-9 || (Math.abs(a[0] - b[0]) <= 1e-9 && a[1] < b[1])) p.hub = k;
        }
    }
    // Paper edges worth drawing: the sheet boundary, and edges between two pieces
    // whose fold histories differ (a crease that was actually folded). Seams left
    // by creases passing through unmoved paper stay invisible.
    const key = q => q[0].toFixed(6) + ',' + q[1].toFixed(6);
    const edgeMap = new Map();
    polys.forEach((p, pi) => {
        const n = p.v.length;
        for (let i = 0; i < n; i++) {
            const a = key(p.v[i].p), b = key(p.v[(i + 1) % n].p);
            const ek = a < b ? a + '|' + b : b + '|' + a;
            if (!edgeMap.has(ek)) edgeMap.set(ek, []);
            edgeMap.get(ek).push({ pi, i, j: (i + 1) % n });
        }
    });
    // `since` is the first stage that separates the two sides; the edge is drawn
    // once that stage begins. Sheet boundaries are always drawn.
    const firstDifference = (a, b) => {
        for (let k = 0; k < stages.length; k++) if (a.has(k) !== b.has(k)) return k;
        return Infinity;
    };
    // A half-edge with no twin is either on the sheet's outline or meets a neighbour
    // that was subdivided differently (a T-junction from the wing tessellation).
    // Resolve it by probing just across the edge in sheet coords.
    const inPoly = (poly, pt) => {
        let sign = 0;
        for (let i = 0; i < poly.v.length; i++) {
            const a = poly.v[i].p, b = poly.v[(i + 1) % poly.v.length].p;
            const c = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
            if (Math.abs(c) < 1e-12) continue;
            const s = Math.sign(c);
            if (sign && s !== sign) return false;
            sign = s;
        }
        return true;
    };
    const acrossEdge = (e) => {
        const P = polys[e.pi], a = P.v[e.i].p, b = P.v[e.j].p;
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const nx = -(b[1] - a[1]) / len * 1e-4, ny = (b[0] - a[0]) / len * 1e-4;
        const probe = inPoly(P, [mx + nx, my + ny]) ? [mx - nx, my - ny] : [mx + nx, my + ny];
        if (Math.abs(probe[0]) + Math.abs(probe[1]) > H) return null;          // off the sheet: outline
        return polys.find(Q => Q !== P && inPoly(Q, probe)) || null;
    };
    const edges = [];
    for (const list of edgeMap.values()) {
        if (list.length === 1) {
            const e = list[0], Q = acrossEdge(e);
            if (!Q) { edges.push({ ...e, since: -1 }); continue; }
            const since = firstDifference(polys[e.pi].moved, Q.moved);
            if (since !== Infinity) edges.push({ ...e, since });
            continue;
        }
        const [e0, e1] = list;
        const since = firstDifference(polys[e0.pi].moved, polys[e1.pi].moved);
        if (since !== Infinity) edges.push({ ...e0, since }, { ...e1, since });
    }
    return { polys, lines, edges };
}

// ---------- the crease pattern ----------

// Every crease the owl leaves on the sheet, in sheet coords, as seen from the cream
// side: 'M' (mountain) or 'V' (valley), with the stage that made it. A stage folds
// toward +z (a valley, seen from +z) unless it is marked `back`; paper that earlier
// stages have flipped shows its terracotta side to +z, which swaps the two.
export function creasePattern() {
    const { polys, lines, edges } = buildModel({ tessellate: false });
    const seen = new Set();
    const out = [];
    for (const e of edges) {
        if (e.since < 0) continue;
        const P = polys[e.pi];
        const a = P.v[e.i].p, b = P.v[e.j].p;
        const k = [a, b].map(q => q[0].toFixed(6) + ',' + q[1].toFixed(6)).sort().join('|');
        if (seen.has(k)) continue;
        seen.add(k);
        let flips = 0;
        for (let j = 0; j < e.since; j++) if (P.rec[j].m) flips++;
        const valley = !lines[e.since].back !== (flips % 2 === 1);
        out.push({ a, b, stage: e.since, mv: valley ? 'V' : 'M' });
    }
    return out;
}

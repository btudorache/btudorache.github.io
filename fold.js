// The folding engine. Most folds are simple: one straight crease at a time, turning a
// flap (or the whole stack) over by 180 degrees; compound stages (below) handle the
// rest. Pure geometry, no three.js; owl-model.js describes what to fold with it.
//
// The sheet is a set of convex polygons. Each stage splits the polygons along its
// crease and mirrors the moving side; at render time the moving side is rotated
// about the crease by 0..180 degrees, and completed stages are replayed as mirrors.
// A stage may restrict itself to one flap (filter), which is only legitimate when
// that flap is free on the moving side of the crease: validate() checks that for
// every stage, so "folded honestly" is tested rather than claimed.
//
// A stage is { a, d, toward, back?, filter?, carry?, dur?, name } — the crease through
// point a with direction d, folding the side containing `toward` — or { turn: true } to
// turn the paper over. Folds are valleys toward +z; `back` makes them mountains.
// `carry` picks pieces on the *fixed* side that go along: a flap joined only to moving
// paper swings with it, uncreased, even where it lies across the crease line.
//
// Some folds move several creases at once: a reverse fold turns the two halves of a
// flap in opposite directions, a slide moves layers within the plane. A compound stage
// { moves: [...], cuts?: [...] } describes one: each move takes the pieces its filter
// picks and maps them either across one line ({ a, d, toward, back }, like a simple
// fold) or through a list of reflections ({ ops: [line, ...] }). `cuts` first splits
// the pieces along lines given on the sheet, where the crease pattern puts the new
// creases. The flat state after a compound stage is exact; the motion that gets there
// is paper-like, not simulated: one reflection turns about its line, a reflection
// with a shift turns about its axis while sliding along it, and a rotation slides in
// the plane of the paper. `land` on a move says where its layers go in the stack.
//
// A model can end by shaping the paper rather than folding it (curving a body, say):
// { shape: (x, y, z, piece) => [x, y, z] } maps the flat state to its final 3D form,
// and the stage eases from one to the other. It changes no fold, so validate() has
// nothing to check there.

// ---------- 2D helpers ----------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function lineOf(def) {
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

// ---------- isometries of the plane: x -> m x + t ----------

const apply = (T, [x, y]) => [T.m[0] * x + T.m[1] * y + T.t[0], T.m[2] * x + T.m[3] * y + T.t[1]];
// A∘B: B first
const compose = (A, B) => ({
    m: [A.m[0] * B.m[0] + A.m[1] * B.m[2], A.m[0] * B.m[1] + A.m[1] * B.m[3],
        A.m[2] * B.m[0] + A.m[3] * B.m[2], A.m[2] * B.m[1] + A.m[3] * B.m[3]],
    t: apply({ m: A.m, t: A.t }, B.t),
});
const IDENTITY = { m: [1, 0, 0, 1], t: [0, 0] };
function mirrorIso(L) {
    const [nx, ny] = L.n, c = 2 * dot(L.a, L.n);
    return { m: [1 - 2 * nx * nx, -2 * nx * ny, -2 * nx * ny, 1 - 2 * ny * ny], t: [c * nx, c * ny] };
}

// How a compound move animates: the net isometry of its pieces, read as a turn about
// a line (a reflection, possibly with a shift along the line) or a slide in the plane
// (a rotation about a point, or a translation). `near` orients the turn: pieces on its
// side of the line rise for a valley, sink for a mountain.
function motionOf(T, back, near) {
    const det = T.m[0] * T.m[3] - T.m[1] * T.m[2];
    if (det < 0) {
        // the fixed direction of the reflection part, then the shift along it
        let u = [T.m[0] + 1, T.m[2]];
        if (Math.hypot(u[0], u[1]) < 1e-9) u = [T.m[1], T.m[3] + 1];
        const len = Math.hypot(u[0], u[1]);
        u = [u[0] / len, u[1] / len];
        const s = dot(T.t, u);
        const w = [T.t[0] - s * u[0], T.t[1] - s * u[1]];
        const a = [w[0] / 2, w[1] / 2];
        const L = lineOf({ a, d: u, toward: near, back });
        return { kind: 'turn', L, shift: [s * u[0], s * u[1]], T };
    }
    const angle = Math.atan2(T.m[2], T.m[0]);
    if (Math.abs(angle) < 1e-9) return { kind: 'slide', angle: 0, c: [0, 0], shift: T.t, T };
    // the centre: (I - R) c = t
    const a = 1 - T.m[0], b = -T.m[1], c = -T.m[2], d = 1 - T.m[3], D = a * d - b * c;
    return { kind: 'slide', angle, c: [(d * T.t[0] - b * T.t[1]) / D, (-c * T.t[0] + a * T.t[1]) / D], shift: [0, 0], T };
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

// Split a convex polygon by a line. Vertices carry sheet coords (p) and flat coords (f);
// the line is in flat coords, or in sheet coords with `by` = 'p'.
export function splitPoly(poly, L, by = 'f') {
    const T = 1e-7;
    const s = poly.v.map(v => dot(sub(v[by], L.a), L.n));
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
    const mk = v => ({ v, layer: poly.layer, rec: poly.rec.slice(), moved: new Set(poly.moved), ...(poly.hAt && { hAt: poly.hAt }) });
    return [mk(neg), mk(pos)].filter(q => q.v.length >= 3);
}

// point in convex polygon (either winding), boundary counts as inside
function inConvex(pts, pt) {
    let sign = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const c = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
        if (Math.abs(c) < 1e-12) continue;
        const s = Math.sign(c);
        if (sign && s !== sign) return false;
        sign = s;
    }
    return true;
}

// ---------- folding ----------

// sheet: the unfolded paper as a convex polygon. tessellate(polys, split) may cut
// pieces further after folding (the owl's wings, for their curl); split(polys, lineDef, which)
// splits the pieces `which` accepts along a line.
export function buildFold({ sheet, stages, tessellate, rank = false, compact = false }) {
    let polys = [{ v: sheet.map(p => ({ p, f: p.slice() })), layer: 0, rec: [], moved: new Set() }];

    const lines = stages.map(st => st.turn || st.moves || st.shape ? null : lineOf(st));
    const motions = stages.map(() => null);   // compound stages: one motion per move

    function compound(st, k) {
        for (const cut of st.cuts || []) {
            const C = lineOf(cut);
            polys = polys.flatMap(p => !cut.filter || cut.filter(p, centroid(p)) ? splitPoly(p, C, 'p') : [p]);
        }
        // every move picks its pieces from the paper as it was before this stage
        const taken = new Set(), moves = [];
        st.moves.forEach((mv, mi) => {
            let group = [], motion;
            if (mv.a) {
                const L = lineOf(mv);
                const next = [];
                for (const p of polys) {
                    if (taken.has(p) || (mv.filter && !mv.filter(p, centroid(p)))) { next.push(p); continue; }
                    for (const q of splitPoly(p, L)) {
                        next.push(q);
                        if (dot(sub(centroid(q), L.a), L.n) > 0) group.push(q);
                    }
                }
                polys = next;
                motion = { kind: 'turn', L, shift: [0, 0], T: mirrorIso(L) };
            } else {
                group = polys.filter(p => !taken.has(p) && mv.filter(p, centroid(p)));
                const T = mv.ops.reduce((acc, op) => compose(mirrorIso(lineOf(op)), acc), IDENTITY);
                const cs = group.map(centroid);
                motion = motionOf(T, !!mv.back, cs.reduce((s, c) => [s[0] + c[0] / cs.length, s[1] + c[1] / cs.length], [0, 0]));
            }
            if (!group.length) throw new Error(`stage ${k} (${st.name}), move ${mi}: no pieces`);
            for (const p of group) taken.add(p);
            moves.push({ mv, group, motion });
        });
        // Layers. The pieces that stay put are the reference, and moves land in order,
        // so a later move can place its layers against an earlier one's. A turned group
        // lands upside down; a slid one keeps its order.
        const settled = polys.filter(p => !taken.has(p));
        for (const p of settled) p.rec[k] = { m: false, lb: p.layer, la: p.layer };
        moves.forEach(({ mv, group, motion }, mi) => {
            const turned = motion.kind === 'turn';
            const land = mv.land || (turned ? (motion.L.back ? 'bottom' : 'top') : 'keep');
            const after = group.map(p => p.v.map(v => apply(motion.T, v.f)));
            const box = bbox(after.flat());
            const near = settled.filter(p => {
                const f = p.v.map(v => v.f);
                return overlaps(bbox(f), box) && after.some(a => clipArea(a, f) > 1e-9);
            });
            const values = [...new Set(group.map(p => p.layer))].sort((a, b) => a - b);
            if (turned) values.reverse();
            const slot = new Map(values.map((v, i) => [v, i]));
            let place;
            if (land === 'keep') place = v => v;
            else if (land === 'top') { const base = Math.max(-1, ...near.map(p => p.layer)); place = v => base + 1 + slot.get(v); }
            else if (land === 'bottom') { const base = Math.min(1, ...near.map(p => p.layer)); place = v => base - values.length + slot.get(v); }
            else {
                // just under (or over) the pieces `land` names, in the gap before the next layer
                const ref = near.filter(p => (land.under || land.over)(p));
                if (!ref.length) throw new Error(`stage ${k} (${st.name}), move ${mi}: nothing to land ${land.under ? 'under' : 'over'}`);
                const all = near.map(p => p.layer);
                let lo, hi;
                if (land.under) { hi = Math.min(...ref.map(p => p.layer)); lo = Math.max(hi - 1, ...all.filter(v => v < hi)); }
                else { lo = Math.max(...ref.map(p => p.layer)); hi = Math.min(lo + 1, ...all.filter(v => v > lo)); }
                place = v => lo + (hi - lo) * (slot.get(v) + 1) / (values.length + 1);
            }
            for (const p of group) {
                const la = place(p.layer);
                // `flip`: whether the move turns the piece over (an even number of
                // reflections, like a slide, leaves it the same side up)
                p.rec[k] = { m: true, lb: p.layer, la, mo: mi, flip: motion.T.m[0] * motion.T.m[3] - motion.T.m[1] * motion.T.m[2] < 0 };
                p.layer = la;
                p.moved.add(k);
                p.v = p.v.map(v => ({ p: v.p, f: apply(motion.T, v.f) }));
            }
            settled.push(...group);
        });
        motions[k] = moves.map(m => m.motion);
    }

    stages.forEach((st, k) => {
        if (st.turn || st.shape) {
            for (const p of polys) p.rec[k] = { m: false, lb: p.layer, la: p.layer };
            return;
        }
        if (st.moves) return compound(st, k);
        const L = lines[k];
        polys = polys.flatMap(p => splitPoly(p, L));
        const movers = [], fixed = [];
        for (const p of polys) {
            const c = centroid(p);
            const onSide = dot(sub(c, L.a), L.n) > 0;
            const moves = onSide ? !st.filter || st.filter(p, c) : !!st.carry && st.carry(p, c);
            (moves ? movers : fixed).push(p);
        }
        if (!movers.length) throw new Error(`stage ${k} (${st.name}): nothing on the moving side`);
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

    // flat coordinates of a polygon before each stage
    const flatHistory = p => {
        const out = [p.v.map(v => v.p)];
        for (let k = 0; k < stages.length; k++) {
            const prev = out[k], r = p.rec[k];
            out[k + 1] = !r.m ? prev
                : motions[k] ? prev.map(f => apply(motions[k][r.mo].T, f))
                : prev.map(f => mirror(f, lines[k]));
        }
        return out;
    };

    // Compact stacking, for drawing: where each piece sits in the stack is its height
    // among the pieces it actually overlaps, in each flat state, rather than a rank
    // among every layer the whole fold ever made, which on a long model spreads the
    // paper over hundreds of levels and lets far-off layers hide ones above them.
    // Worked out on the pieces before tessellation (it only cuts them smaller).
    let pivots = null;
    if (compact) {
        for (const p of polys) p.fAt = flatHistory(p);
        stackHeights(polys, stages.length);
        // each moving group turns about the bottom of its own stack
        pivots = stages.map((st, k) => {
            const low = new Map();
            for (const p of polys) if (p.rec[k].m) {
                const g = p.rec[k].mo || 0;
                low.set(g, Math.min(low.has(g) ? low.get(g) : Infinity, p.hAt[k]));
            }
            return low;
        });
    }

    if (tessellate) {
        polys = tessellate(polys, (list, def, which) => {
            const C = lineOf(def);
            return list.flatMap(p => which(p) ? splitPoly(p, C) : [p]);
        });
    }

    // Layer numbers only order the paper, and compound stages leave fractions. Ranked,
    // they become consecutive integers, so the stack is as thin as it is in the hand.
    if (rank) {
        const values = new Set();
        for (const p of polys) { values.add(p.layer); for (const r of p.rec) { values.add(r.lb); values.add(r.la); } }
        const order = new Map([...values].sort((a, b) => a - b).map((v, i) => [v, i]));
        const mid = Math.floor(order.size / 2);
        // fresh records: pieces split from one another share their earlier ones
        for (const p of polys) {
            p.rec = p.rec.map(r => ({ ...r, lb: order.get(r.lb) - mid, la: order.get(r.la) - mid }));
            p.layer = order.get(p.layer) - mid;
        }
    }

    // flat coordinates of every polygon before each stage
    for (const p of polys) {
        p.fAt = flatHistory(p);
        // Fan-triangulate from a corner chosen by position, so two paper layers that
        // are identical polygons (possibly listed from different corners) get the
        // same triangles and stay parallel when bent.
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
    // (in a compound stage, two pieces moved by different moves part there too)
    const moveKey = r => r.m ? (r.mo || 0) : -1;
    const firstDifference = (A, B) => {
        for (let k = 0; k < stages.length; k++) if (moveKey(A.rec[k]) !== moveKey(B.rec[k])) return k;
        return Infinity;
    };
    // A half-edge with no twin is either on the sheet's outline or meets a neighbour
    // that was subdivided differently (a T-junction). Resolve it by probing just
    // across the edge in sheet coords.
    const acrossEdge = (e) => {
        const P = polys[e.pi], a = P.v[e.i].p, b = P.v[e.j].p;
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const nx = -(b[1] - a[1]) / len * 1e-4, ny = (b[0] - a[0]) / len * 1e-4;
        const pts = P.v.map(v => v.p);
        const probe = inConvex(pts, [mx + nx, my + ny]) ? [mx - nx, my - ny] : [mx + nx, my + ny];
        if (!inConvex(sheet, probe)) return null;          // off the sheet: outline
        return polys.find(Q => Q !== P && inConvex(Q.v.map(v => v.p), probe)) || null;
    };
    const edges = [];
    for (const list of edgeMap.values()) {
        if (list.length === 1) {
            const e = list[0], Q = acrossEdge(e);
            if (!Q) { edges.push({ ...e, since: -1 }); continue; }
            const since = firstDifference(polys[e.pi], Q);
            if (since !== Infinity) edges.push({ ...e, since, twin: polys.indexOf(Q) });
            continue;
        }
        const [e0, e1] = list;
        const since = firstDifference(polys[e0.pi], polys[e1.pi]);
        if (since !== Infinity) edges.push({ ...e0, since, twin: e1.pi }, { ...e1, since, twin: e0.pi });
    }
    return { polys, lines, motions, pivots, edges, stages, sheet };
}

// How high each piece sits in each flat state s: one above the highest piece below it
// that it overlaps (pieces side by side on the same layer do not stack).
function stackHeights(polys, N) {
    for (const p of polys) p.hAt = new Array(N + 1);
    for (let s = 0; s <= N; s++) {
        const items = polys.map(p => ({ p, f: p.fAt[s], box: bbox(p.fAt[s]), l: s < N ? p.rec[s].lb : p.layer }))
            .sort((a, b) => a.l - b.l);
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            let h = 0;
            for (let j = 0; j < i; j++) {
                const o = items[j];
                if (o.l === it.l || o.h + 1 <= h || !overlaps(o.box, it.box)) continue;
                if (clipArea(o.f, it.f) > 1e-9) h = o.h + 1;
            }
            it.h = h;
            it.p.hAt[s] = h;
        }
    }
}

// ---------- posing: where every corner is at time t ----------

// t runs over stages: stage K is folding while K <= t < K + 1. Returns, per
// polygon, its corners in 3D (x, y in sheet units, z up from the paper), with
// layers eps apart.
export function pose(model, t, eps) {
    const { polys, lines, stages } = model;
    const K = clamp(Math.floor(t), 0, stages.length - 1);
    const prog = clamp(t - K, 0, 1);
    const M = model.motions && model.motions[K];
    const th = prog * Math.PI, c = Math.cos(th), s = Math.sin(th);
    // turning about line L by the stage's progress, then shifting along it
    const turn = (q, L, z0, shift) => {
        const qx = q[0] - L.a[0], qy = q[1] - L.a[1];
        const par = qx * L.d[0] + qy * L.d[1];
        const px = qx - par * L.d[0], py = qy - par * L.d[1];
        return [
            L.a[0] + par * L.d[0] + c * px + shift[0] * prog,
            L.a[1] + par * L.d[1] + c * py + shift[1] * prog,
            L.sgn * s * (L.d[0] * py - L.d[1] * px) + z0,
        ];
    };
    const none = [0, 0];
    const shape = stages[K].shape;
    // With compact stacking (buildFold's `compact`), a piece's height eases from where
    // it sits before this stage to where it sits after; a turning stack turns its
    // layers' heights with it, about the bottom of the moving group, so the stack
    // stays a stack all the way over instead of its layers passing through each other.
    if (model.pivots) return polys.map(p => {
        const r = p.rec[K], f = p.fAt[K];
        const hb = p.hAt[K] * eps, ha = p.hAt[K + 1] * eps;
        const z0 = hb + (ha - hb) * prog;
        if (shape) return f.map(q => {
            const to = shape(q[0], q[1], z0, p);
            return [q[0] + (to[0] - q[0]) * prog, q[1] + (to[1] - q[1]) * prog, z0 + (to[2] - z0) * prog];
        });
        if (!r.m) return f.map(q => [q[0], q[1], z0]);
        const mo = M ? M[r.mo] : { kind: 'turn', L: lines[K], shift: none };
        if (mo.kind === 'turn') {
            const L = mo.L, v = L.back ? -1 : 1;
            const hp = model.pivots[K].get(r.mo || 0) * eps, w = hb - hp;
            // at the end the layer has turned right over (hp - w); ease on to its height
            const land = (ha - hp + w) * prog;
            return f.map(q => {
                const qx = q[0] - L.a[0], qy = q[1] - L.a[1];
                const par = qx * L.d[0] + qy * L.d[1];
                const px = qx - par * L.d[0], py = qy - par * L.d[1];
                return [
                    L.a[0] + par * L.d[0] + c * px - v * w * s * L.n[0] + mo.shift[0] * prog,
                    L.a[1] + par * L.d[1] + c * py - v * w * s * L.n[1] + mo.shift[1] * prog,
                    hp + L.sgn * s * (L.d[0] * py - L.d[1] * px) + w * c + land,
                ];
            });
        }
        const a = mo.angle * prog, ca = Math.cos(a), sa = Math.sin(a);
        return f.map(q => {
            const x = q[0] - mo.c[0], y = q[1] - mo.c[1];
            return [mo.c[0] + ca * x - sa * y + mo.shift[0] * prog, mo.c[1] + sa * x + ca * y + mo.shift[1] * prog, z0];
        });
    });
    return polys.map(p => {
        const r = p.rec[K], f = p.fAt[K];
        const z0 = (r.m ? r.lb + (r.la - r.lb) * prog : r.lb) * eps;
        if (shape) return f.map(q => {
            const to = shape(q[0], q[1], z0, p);
            return [q[0] + (to[0] - q[0]) * prog, q[1] + (to[1] - q[1]) * prog, z0 + (to[2] - z0) * prog];
        });
        if (!r.m) return f.map(q => [q[0], q[1], z0]);
        if (!M) return f.map(q => turn(q, lines[K], z0, none));
        const mo = M[r.mo];
        if (mo.kind === 'turn') return f.map(q => turn(q, mo.L, z0, mo.shift));
        // a slide in the plane: rotate about the centre and move by the shift
        const a = mo.angle * prog, ca = Math.cos(a), sa = Math.sin(a);
        return f.map(q => {
            const x = q[0] - mo.c[0], y = q[1] - mo.c[1];
            return [mo.c[0] + ca * x - sa * y + mo.shift[0] * prog, mo.c[1] + sa * x + ca * y + mo.shift[1] * prog, z0];
        });
    });
}

// ---------- the flat state after k stages, as seen by the folder ----------

// did this stage turn the piece over? A simple fold always does when it moves it
const turnsOver = r => r.m && r.flip !== false;

// Pieces in painting order (farthest first) with the side of the paper that faces
// the folder: 'front' or 'back'. Turning the paper over mirrors the view.
export function flatState(model, k) {
    const turns = model.stages.slice(0, k).filter(s => s.turn).length;
    const flipped = turns % 2 === 1;
    const pieces = model.polys.map(p => {
        const flips = p.rec.slice(0, k).filter(turnsOver).length;
        const layer = k < model.stages.length ? p.rec[k].lb : p.layer;
        const pts = p.fAt[k].map(([x, y]) => [flipped ? -x : x, y]);
        return { pts, layer: flipped ? -layer : layer, side: (flips % 2 === 1) !== flipped ? 'back' : 'front', poly: p };
    });
    return pieces.sort((a, b) => a.layer - b.layer);
}

// ---------- the crease pattern ----------

// Every crease the model leaves on the sheet, in sheet coords, as seen from the
// front: 'M' (mountain) or 'V' (valley), with the stage that made it. A stage folds
// toward +z (a valley, seen from +z) unless it is marked `back`; paper that earlier
// stages have flipped shows its back to +z, which swaps the two.
export function creasePattern(model) {
    const { polys, lines, edges } = model;
    const seen = new Set();
    const out = [];
    for (const e of edges) {
        if (e.since < 0) continue;
        const P = polys[e.pi];
        const a = P.v[e.i].p, b = P.v[e.j].p;
        const k = [a, b].map(q => q[0].toFixed(6) + ',' + q[1].toFixed(6)).sort().join('|');
        if (seen.has(k)) continue;
        seen.add(k);
        let valley;
        if (lines[e.since]) {
            let flips = 0;
            for (let j = 0; j < e.since; j++) if (turnsOver(P.rec[j])) flips++;
            valley = !lines[e.since].back !== (flips % 2 === 1);
        } else {
            // a compound stage: from the stack it leaves. The upper of the two pieces
            // faces down with its front exactly when their fronts meet: a valley
            const Q = polys[e.twin];
            const k = e.since, up = P.rec[k].la >= Q.rec[k].la ? P : Q;
            valley = up.rec.slice(0, k + 1).filter(turnsOver).length % 2 === 1;
        }
        out.push({ a, b, stage: e.since, mv: valley ? 'V' : 'M' });
    }
    return out;
}

// ---------- validation: is every stage a fold real paper can make? ----------

// Area of the intersection of two convex polygons (Sutherland–Hodgman).
function clipArea(A, B) {
    let out = A;
    const orient = Math.sign(signedArea(B)) || 1;
    for (let i = 0; i < B.length && out.length; i++) {
        const a = B[i], b = B[(i + 1) % B.length];
        const side = q => orient * ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]));
        const inp = out; out = [];
        for (let j = 0; j < inp.length; j++) {
            const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
            if (sp >= 0) out.push(p);
            if ((sp >= 0) !== (sq >= 0)) {
                const t = sp / (sp - sq);
                out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
            }
        }
    }
    return out.length >= 3 ? Math.abs(signedArea(out)) : 0;
}
function signedArea(P) {
    let s = 0;
    for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; }
    return s / 2;
}

// for problem reports: a piece by its middle on the sheet, and its layer then
const fmt = q => `(${q[0].toFixed(3)},${q[1].toFixed(3)})`;
function describe(p, s) {
    const c = p.v.reduce((m, v) => [m[0] + v.p[0] / p.v.length, m[1] + v.p[1] / p.v.length], [0, 0]);
    const l = s < p.rec.length ? p.rec[s].lb : p.layer;
    return `sheet${fmt(c)} layer ${+l.toFixed(3)}`;
}

// The part of segment ab strictly inside convex polygon P (either winding), as [t0, t1].
function segmentInside(a, b, P) {
    let t0 = 0, t1 = 1;
    const orient = Math.sign(signedArea(P)) || 1;
    for (let i = 0; i < P.length; i++) {
        const p = P[i], q = P[(i + 1) % P.length];
        // distance from the edge's line, and a point within rounding of it is on the edge
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        const side = x => orient * ((q[0] - p[0]) * (x[1] - p[1]) - (q[1] - p[1]) * (x[0] - p[0])) / len;
        let sa = side(a), sb = side(b);
        if (Math.abs(sa) < 1e-9) sa = 0;
        if (Math.abs(sb) < 1e-9) sb = 0;
        if (sa <= 0 && sb <= 0) return null;
        if (sa < 0) t0 = Math.max(t0, sa / (sa - sb));
        else if (sb < 0) t1 = Math.min(t1, sa / (sa - sb));
    }
    return t1 > t0 ? [t0, t1] : null;
}

// Is the flat state after `s` stages a stack real paper can make? Two conditions from
// flat-folding theory: no layer may lie between the two sides of a fold it crosses
// (it would have to pass through the fold), and two folds on the same line with their
// flaps on the same side must nest, not interleave. Returns the first problem, or null.
function flatLayerProblem(model, joined, s, tol, detail) {
    const { polys, stages } = model;
    const N = stages.length;
    const layer = p => s < N ? p.rec[s].lb : p.layer;
    const creases = [];
    for (const [e0, e1] of joined) {
        const P = polys[e0.pi], Q = polys[e1.pi];
        const f = P.fAt[s], a = f[e0.i], b = f[(e0.i + 1) % f.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-6) continue;
        const n = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
        const mid = X => X.fAt[s].reduce((m, q) => [m[0] + q[0], m[1] + q[1]], [0, 0]).map(v => v / X.fAt[s].length);
        const cp = mid(P), sp = dot(sub(cp, a), n), sq = dot(sub(mid(Q), a), n);
        if (Math.abs(sp) < tol || Math.abs(sq) < tol || Math.sign(sp) !== Math.sign(sq)) continue;   // not folded here
        const lp = layer(P), lq = layer(Q);
        creases.push({ a, b, cp, dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len], lo: Math.min(lp, lq), hi: Math.max(lp, lq), P, Q });
    }
    for (const e of creases) {
        if (e.hi - e.lo < 1e-12) continue;
        for (const C of polys) {
            if (C === e.P || C === e.Q) continue;
            const l = layer(C);
            if (!(l > e.lo && l < e.hi)) continue;
            const inside = segmentInside(e.a, e.b, C.fAt[s]);
            if (inside && (inside[1] - inside[0]) * Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) > 1e-5) {
                return 'a layer lies inside a fold it crosses — it would have to pass through the paper'
                    + (detail ? ` [fold ${describe(e.P, s)} / ${describe(e.Q, s)} at ${fmt(e.a)}-${fmt(e.b)}; layer ${describe(C, s)}]` : '');
            }
        }
    }
    // folds on one line: bucket by the line itself
    const byLine = new Map();
    for (const e of creases) {
        const d = e.dir[0] < -1e-9 || (Math.abs(e.dir[0]) < 1e-9 && e.dir[1] < 0) ? [-e.dir[0], -e.dir[1]] : e.dir;
        const key = `${d[0].toFixed(4)},${d[1].toFixed(4)},${(d[0] * e.a[1] - d[1] * e.a[0]).toFixed(4)}`;
        if (!byLine.has(key)) byLine.set(key, []);
        // which side the flaps lie on, against the line's own direction, not the edge's
        byLine.get(key).push({ ...e, d, side: Math.sign(d[0] * (e.cp[1] - e.a[1]) - d[1] * (e.cp[0] - e.a[0])) });
    }
    for (const list of byLine.values()) {
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            const e = list[i], g = list[j];
            if (e.side !== g.side || e.P === g.P || e.P === g.Q || e.Q === g.P || e.Q === g.Q) continue;
            const span = x => [dot(x.a, e.d), dot(x.b, e.d)].sort((u, v) => u - v);
            const [a0, a1] = span(e), [b0, b1] = span(g);
            if (Math.min(a1, b1) - Math.max(a0, b0) < 1e-5) continue;
            const inE = l => l > e.lo && l < e.hi;
            const outE = l => l < e.lo || l > e.hi;
            if ((inE(g.lo) && outE(g.hi)) || (outE(g.lo) && inE(g.hi))) {
                return 'two folds on the same line interleave — their flaps would pass through each other'
                    + (detail ? ` [${describe(e.P, s)} / ${describe(e.Q, s)} and ${describe(g.P, s)} / ${describe(g.Q, s)}]` : '');
            }
        }
    }
    return null;
}

// For each fold stage, two things real paper forbids:
//  - tearing: a moving piece may stay joined to a fixed piece only along the crease;
//    anywhere else, the flap is not free and folding it would rip the paper
//  - passing through: a flap swinging up (valley) must have no fixed layer on top of
//    it wherever they overlap; a flap swinging down (mountain), none underneath. A
//    carried piece beyond the crease starts out the opposite way, so for it the
//    blocking layers are the ones on the other side.
// Returns a list of problems; empty means every stage can be folded by hand.
export function validate(model, { tol = 1e-6, detail = false } = {}) {
    const { polys, lines, stages } = model;
    const problems = [];
    const key = q => q[0].toFixed(5) + ',' + q[1].toFixed(5);
    // which pieces share a length of paper edge in the sheet (are joined)
    const joined = [];
    const edgeOwners = new Map();
    polys.forEach((p, pi) => {
        const n = p.v.length;
        for (let i = 0; i < n; i++) {
            const a = key(p.v[i].p), b = key(p.v[(i + 1) % n].p);
            const ek = a < b ? a + '|' + b : b + '|' + a;
            if (!edgeOwners.has(ek)) edgeOwners.set(ek, []);
            edgeOwners.get(ek).push({ pi, i });
        }
    });
    for (const list of edgeOwners.values()) if (list.length === 2) joined.push(list);

    stages.forEach((st, k) => {
        if (st.turn || st.shape) return;
        const layerProblem = flatLayerProblem(model, joined, k + 1, tol, detail);
        if (layerProblem) problems.push(`after stage ${k} (${st.name}): ${layerProblem}`);
        if (st.moves) {
            // a compound move is paper-like, so only its result is checked: joined
            // pieces must still meet along their shared edge
            for (const [e0, e1] of joined) {
                const P = polys[e0.pi], Q = polys[e1.pi];
                if (P.rec[k].m === Q.rec[k].m && P.rec[k].mo === Q.rec[k].mo) continue;
                const fp = P.fAt[k + 1], fq = Q.fAt[k + 1], np = fp.length, nq = fq.length;
                const a = fp[e0.i], b = fp[(e0.i + 1) % np], c = fq[e1.i], d = fq[(e1.i + 1) % nq];
                const same = (x, y) => Math.hypot(x[0] - y[0], x[1] - y[1]) < 1e-6;
                if (!((same(a, d) && same(b, c)) || (same(a, c) && same(b, d)))) {
                    problems.push(`stage ${k} (${st.name}): two joined pieces come apart — the paper would tear`);
                    break;
                }
            }
            return;
        }
        const L = lines[k];
        // tearing
        for (const [e0, e1] of joined) {
            const P = polys[e0.pi], Q = polys[e1.pi];
            if (P.rec[k].m === Q.rec[k].m) continue;
            const f = P.fAt[k], n = f.length;
            const a = f[e0.i], b = f[(e0.i + 1) % n];
            const off = q => Math.abs(dot(sub(q, L.a), L.n));
            if (off(a) > tol || off(b) > tol) {
                problems.push(`stage ${k} (${st.name}): moving paper stays joined to fixed paper away from the crease — it would tear`);
                break;
            }
        }
        // passing through other layers
        const movers = polys.filter(p => p.rec[k].m), fixed = polys.filter(p => !p.rec[k].m);
        outer:
        for (const M of movers) for (const F of fixed) {
            const f = M.fAt[k];
            const beyond = f.reduce((s, q) => s + dot(sub(q, L.a), L.n), 0) < 0;   // on the fixed side: carried
            const up = !L.back !== beyond;
            const blocks = up ? F.rec[k].lb > M.rec[k].lb : F.rec[k].lb < M.rec[k].lb;
            if (!blocks) continue;
            if (clipArea(M.fAt[k], F.fAt[k]) > 1e-7) {
                problems.push(`stage ${k} (${st.name}): the flap would pass through a layer ${L.back ? 'under' : 'over'} it`);
                break outer;
            }
        }
    });
    return problems;
}

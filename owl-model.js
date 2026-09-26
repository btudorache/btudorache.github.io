// The owl: Román Díaz's "Búho" (Origami Essence, 2009, p. 17), folded by fold.js. Pure
// geometry, no three.js, so the page, the crease-pattern glyph and tools/owl-svg.mjs all
// fold the same owl.
//
// Sheet: a unit square standing on a corner, centred on the origin, y up. The front
// (+z) is the side the diagram draws white, yellow here; the back, grey in the diagram,
// is charcoal. The front starts face up.
//
// Folds are written as the folder sees them: after a turn-over the folder's left and
// right are the sheet's mirrored, and their valley folds are mountains for the sheet.
// `view()` converts. Pieces are named by the stages that moved them (`after(id)`).
//
// Every landmark below comes from the diagram's reference points, checked against the
// book's crease pattern (p. 17) and, figure by figure, against the drawings
// (tools/check-owl.py scores figures 2 to 13; the close-ups were compared by overlay).

import { buildFold, creasePattern as creasesOf } from './fold.js';

// the paper: yellow on the front, a warm charcoal behind (lighter on the dark page, so
// the owl keeps its outline against it)
export const YELLOW = 0xe0ac2e;
export const CHARCOAL = 0x3a3632;
export const CHARCOAL_ON_DARK = 0x625b53;

// ---------- geometry ----------

export const H = Math.SQRT1_2;            // half-diagonal
const T = Math.tan(Math.PI / 8);          // tan 22.5°: the kite folds
export const SHEET = [[0, -H], [H, 0], [0, H], [-H, 0]];

const Y2 = H * T;                         // step 2: the line through the kite creases' ends
const Y3a = (H + Y2) / 2;                 // step 3: top corner to (0, Y2)
const Y3b = (-H + Y2) / 2;                // step 3: bottom corner to (0, Y2)
const Y4 = (-H + Y3b) / 2;                // step 4: bottom corner up to (0, Y3b)
const Y11 = 2 * Y2 - Y3a;                 // step 11: step 3's upper crease, on the point folded down in step 7
// step 9: that crease ends at the reverse fold's edge; the bisector there crosses the
// centre line at Y9 (exactly 2 * Y11, as tan 22.5° solves t² + 2t = 1)
const Y9 = Y11 + (Y3a - Y2) * T;
// step 18: the pleat's creases on the beak. The mountain is step 11's line; the diagram
// gives no landmark for the valley, and the crease pattern puts it at 0.0608 (after
// correcting the scan by the mountain's own offset): Y11/√2 to within the scan's accuracy.
const P18m = Y11, P18v = Y11 * Math.SQRT1_2;

const P = [0, Y3b];                       // where the tail's tip lies on the main layer
const B = [0, -H];                        // the bottom corner

// ---------- picking pieces ----------

const sheetMid = p => p.v.reduce((m, v) => [m[0] + v.p[0] / p.v.length, m[1] + v.p[1] / p.v.length], [0, 0]);
const inTriangle = (a, b, c) => p => {
    const [x, y] = sheetMid(p);
    const s = (u, v) => (v[0] - u[0]) * (y - u[1]) - (v[1] - u[1]) * (x - u[0]);
    const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
    return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
};
const sheetY = p => sheetMid(p)[1];
// pieces moved by any of these stages (by id; resolved once the plan is built)
function after(...ids) { return p => ids.some(id => movedIn(id)(p)); }

// ---------- step 7's slide, from the crease pattern ----------
//
// Q is where the kite crease meets the tail's fold; E is the point of the sheet's edge
// that step 5 laid on P. Near the bottom of each side flap the crease pattern has two
// new creases, E-Q and Q-F (F on the edge), which cut the flap's corner into three
// triangles. Step 5 left the corner folded along the tail's crease; the slide refolds
// it along these instead:
//   - the triangle between E-Q and the tail's crease turns over the line P-Q, white up;
//   - the triangle below it, still folded with the tail, slides round to join it;
//   - the sliver beyond Q-F swings back across the kite crease and lies flat with the
//     tail again, undoing step 5's crease through the tail.

function slide7() {
    const moves = [], cuts = [];
    const reach = Y4 + H;                              // how far the tail's crease is from B
    for (const s of [-1, 1]) {
        const q = reach * T, t = (reach - q) / 2;
        const Q = [s * q, Y4];
        const F = [s * (q + t), Y4 - t];               // Q-F: the tail's crease, as step 5 laid it on the flap
        const G = [s * reach, Y4];                     // the tail's crease meets the edge
        const E = [s * (Y3b + H) / Math.SQRT2, -H + (Y3b + H) / Math.SQRT2];
        // step 5 folded the tail's corner along the kite crease as it lay then, so on the
        // sheet that crease runs from Q to S, not along the sheet's own kite line
        const yk = (reach + Y4 - H * T) / (1 + T);
        const S = [s * (yk + H) * T, 2 * Y4 - yk];
        const K = { a: B, d: [s * T, 1] }, Y = { a: [0, Y4], d: [1, 0] };
        const D = { a: P, d: [Q[0] - P[0], Q[1] - P[1]] };
        const corner = p => s * sheetMid(p)[0] > 0 && sheetY(p) < Y3b;
        cuts.push({ a: Q, d: [F[0] - Q[0], F[1] - Q[1]], filter: corner }, { a: E, d: [Q[0] - E[0], Q[1] - E[1]], filter: corner });
        moves.push(
            { filter: inTriangle(Q, G, E), ops: [D], land: 'top' },
            { filter: inTriangle(Q, F, G), ops: [K, Y, K, D], land: 'top' },
            { filter: inTriangle(Q, F, S), ops: [K], land: 'bottom' },
        );
    }
    return { moves, cuts };
}

// ---------- reverse folds ----------
//
// An inside reverse fold pushes a corner in between its layers: the layers in front
// (`front`) turn backwards, the rest turn forwards, and both come to rest inside, the
// front ones just under their own fixed parts and the back ones just over theirs.
// Where they end up is all the flat state needs; on the way there, both are shown
// turning backwards (a reflection lands in the same place whichever way it turns), so
// from the front the corner folds away behind, as a pushed-in corner looks, instead
// of the back layers swinging out through the front ones.

function reverse({ a, d, toward, front }) {
    const back = p => !front(p);
    return { moves: [
        { a, d, toward, back: true, filter: front, land: { under: front } },
        { a, d, toward, back: true, filter: back, land: { over: back } },
    ] };
}

// ---------- step 12: the ears ----------
//
// The line bisects the angle between straight down (the pocket's edge along the centre
// line) and the direction to the top edge's corner, where that edge lands.

function earLine(s) {
    const c = [s * (Y2 - Y9), Y9 - Y11], len = Math.hypot(c[0], c[1]);
    return [c[0] / len, c[1] / len - 1];
}
function ear(s) {
    const id = s > 0 ? 'ear12R' : 'ear12L', tucked = s > 0 ? 'rev8R' : 'rev8L';
    // (not the parts step 10 folded behind with the top: they left the pocket)
    const inPocket = p => after(tucked)(p) && !after('top10')(p);
    const pointCorner = p => inPocket(p) && after('top7')(p);
    const line = { a: [0, Y11], d: earLine(s), toward: [0, -H] };
    // it turns out backwards, behind the head's front layers, and rises past the head's
    // edge from behind, as an ear drawn out of its pocket does
    return { id, name: 'pull out an ear', moves: [
        { ...line, back: true, filter: pointCorner, land: { under: pointCorner } },
        { ...line, back: true, filter: p => inPocket(p) && !after('top7')(p), land: { under: after(id) } },
    ], dur: 0.9 };
}

// ---------- steps 15-17: the eyes ----------
//
// Each eye is the white patch between the brow and the ear. Its top corner is where the
// brow's edge (step 13) meets the pocket's edge (step 8), at (Y2/2, Y2/2); the angle there,
// between the brow's edge and the pocket's edge, is 135°, and its bisector, extended,
// runs up through the ear's tip. The paper beyond it comes in two parts, each joined to
// the rest only along the bisector: in front, the brow band's corner and what is left
// of the point from step 11 (joined to each other along step 11's crease); behind, the
// corner tucked in step 8 and, joined to it along the ear's hinge, the matching sliver
// of the ear's top layer. The reverse fold turns the front part backwards and the back
// part forwards, into the brow's pocket; the ear's grey lower layers show where they were.

function eye(s) {
    const side = s > 0 ? 'R' : 'L', tucked = s > 0 ? 'rev8R' : 'rev8L';
    const line = { a: [s * Y2 / 2, Y2 / 2], d: [-s * Math.sin(Math.PI / 8), -Math.cos(Math.PI / 8)], toward: [s * H, 0] };
    const remnant = p => after('up11')(p) && !after('brow13')(p);
    const band = p => after('top7')(p) && !after('rev8L', 'rev8R', 'top10', 'up11')(p);
    const front = p => remnant(p) || band(p);
    const back = p => after(tucked)(p) && after('top7')(p) && !after('top10')(p);
    const ear = after(s > 0 ? 'ear12R' : 'ear12L');
    const pocket = p => back(p) && !ear(p);
    return [
        // 15-16. (not folded here) crease the bisector: fold everything beyond it over and
        //     unfold. That leaves the paper as it was, and the reverse fold below makes the
        //     same crease; folding the whole corner over and back would only flash layers
        //     from inside the head (the ear's sliver among them).
        // 17. reverse-fold it into the brow's pocket
        //     The ear's sliver goes in under the ear's own top layer, not with the tucked
        //     corner: it reaches out past the pocket's edge and across the ear's hinge, so
        //     it cannot lie inside either fold.
        { id: `eye17${side}`, name: 'reverse-fold the eye', moves: [
            { ...line, filter: front, back: true, land: { under: front } },
            { ...line, filter: pocket, back: true, land: { over: pocket } },
            { ...line, filter: p => back(p) && ear(p), back: true, land: { under: p => back(p) && ear(p) } },
        ], dur: 0.9 },
    ];
}

// ---------- step 18: the beak's pleat ----------

function pleat18() {
    const beak = after('brow13');
    const onSheet = y => H - y;               // steps 7, 11 and 13 put the beak's sheet y at H - y
    const mountain = onSheet(P18m), valley = onSheet(P18v);
    const top = p => beak(p) && sheetY(p) < mountain;
    const strip = p => beak(p) && sheetY(p) > mountain && sheetY(p) < valley;
    const tip = p => beak(p) && sheetY(p) > valley;
    const lift = 2 * (P18m - P18v);           // how far the tip slides up
    return {
        cuts: [{ a: [0, mountain], d: [1, 0], filter: beak }, { a: [0, valley], d: [1, 0], filter: beak }],
        moves: [
            // the strip turns under the beak's top along the mountain
            { filter: strip, ops: [{ a: [0, P18m], d: [1, 0] }], back: true, land: { under: top } },
            // and the tip slides up behind the strip
            { filter: tip, ops: [{ a: [0, P18m], d: [1, 0] }, { a: [0, P18m + lift / 2], d: [1, 0] }], land: { under: strip } },
        ],
    };
}

// ---------- steps 19-22: curving the body, pleating the tail ----------
//
// Steps 19 and 20 precrease a fan of lines round P (the tail's apex): the tail's own
// facets at 0° and ±22.5° from straight down, its edges at ±45°, and the bisectors at
// ±67.5°. Step 21 curves the body with them, and step 22 angles the tail's facets so the
// owl can stand. That is shaping, not flat folding, so it is one last stage that bends
// the flat owl into its final form:
//   - the body curves round a vertical axis, less and less toward the face, which stays flat;
//   - below the horizontal valley through P, the paper leans back, like the owl's base;
//   - the tail's facets pleat: ridges at 0° and ±45°, valleys at ±22.5° (as step 22
//     draws them), each facet a flat triangle from P, fading out across the lower sides.
// The creases of steps 19 and 20 are not marked separately: they end inside the paper,
// so they are not folds the flat state can show.

const LEAN = 50 * Math.PI / 180;          // how far the base leans back
const CURVE = 1 / 0.38;                   // the body's curvature below the face
const PLEAT = 0.2;                        // the tail's facets: rise per unit of distance from P
const FAN = [-90, -67.5, -45, -22.5, 0, 22.5, 45, 67.5, 90].map(a => a * Math.PI / 180);
const FAN_RISE = [0, 0, 1, -1, 1, -1, 1, 0, 0];
const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

// the pleat's height below P: linear inside each sector of the fan, so every facet is flat
function pleat(x, yr) {
    const th = Math.atan2(x, -yr);
    for (let i = 0; i < FAN.length - 1; i++) {
        if (th < FAN[i] - 1e-9 || th > FAN[i + 1] + 1e-9) continue;
        const e0 = [Math.sin(FAN[i]), -Math.cos(FAN[i])], e1 = [Math.sin(FAN[i + 1]), -Math.cos(FAN[i + 1])];
        const det = e0[0] * e1[1] - e0[1] * e1[0];
        const a = (x * e1[1] - yr * e1[0]) / det, b = (e0[0] * yr - e0[1] * x) / det;
        return PLEAT * (a * FAN_RISE[i] + b * FAN_RISE[i + 1]);
    }
    return 0;
}

function sculpt(x, y, z) {
    const k = CURVE * smooth(0.1, -0.06, y);
    const yr = y - P[1];
    const zp = z + (yr < 0 ? pleat(x, yr) : 0);
    // the body's surface at this x, bent round a vertical axis, and its normal there
    const bx = k < 1e-6 ? x : Math.sin(k * x) / k, bz = k < 1e-6 ? 0 : (Math.cos(k * x) - 1) / k;
    const nx = Math.sin(k * x), nz = Math.cos(k * x);
    if (yr >= 0) return [bx + zp * nx, y, bz + zp * nz];
    // below the valley through P: lean back, easing in over a short band so the
    // layers' thickness stays continuous across the crease
    const b = LEAN * smooth(0, -0.03, yr);
    const up = yr * Math.cos(b) - zp * Math.sin(b), out = yr * Math.sin(b) + zp * Math.cos(b);
    return [bx + out * nx, P[1] + up, bz + out * nz];
}

// Where the final shape has real creases (the tail's pleats, the base's valley), so a
// renderer knows where not to smooth the shading: a point of the flat owl on one of them.
export function sharpCrease(x, y) {
    const yr = y - P[1];
    if (Math.abs(yr) < 1e-6) return true;
    if (yr > 0) return false;
    return FAN.some(a => Math.abs(x * Math.cos(a) + yr * Math.sin(a)) < 1e-6);
}

// Cut the finished paper finely enough to bend smoothly: into strips for the curve,
// along the fan's rays for the tail's facets, and across the band where the base leans.
function tessellateForShaping(polys, split) {
    const all = () => true;
    for (let x = -0.3; x <= 0.3001; x += 0.02) polys = split(polys, { a: [x, 0], d: [0, 1] }, all);
    for (const y of [0.1, 0.06, 0.02, -0.02, -0.06, P[1], P[1] - 0.01, P[1] - 0.02, P[1] - 0.03])
        polys = split(polys, { a: [0, y], d: [1, 0] }, all);
    for (const a of FAN) polys = split(polys, { a: P, d: [Math.sin(a), -Math.cos(a)] }, all);
    return polys;
}

// `tessellate` cuts the paper finely for the final shaping; flat uses (the fallback
// drawing, the crease pattern, validate()) leave it off
export function buildModel({ tessellate = true } = {}) {
    return buildFold({ sheet: SHEET, stages, tessellate: tessellate ? tessellateForShaping : null, rank: true, compact: true });
}

// every crease the owl leaves on the sheet, seen from the yellow side (fold.js)
export const creasePattern = () => creasesOf(buildModel({ tessellate: false }));

// ---------- the crease sequence ----------

const plan = [
    // 1. crease both diagonals
    { id: 'c1v', name: 'crease diagonal', a: [0, 0], d: [0, 1], toward: [1, 0], dur: 0.3 },
    { id: 'c1vu', name: 'unfold', a: [0, 0], d: [0, 1], toward: [-1, 0], only: 'c1v', dur: 0.3 },
    { id: 'c1h', name: 'crease diagonal', a: [0, 0], d: [1, 0], toward: [0, -1], dur: 0.3 },
    { id: 'c1hu', name: 'unfold', a: [0, 0], d: [1, 0], toward: [0, 1], only: 'c1h', dur: 0.3 },
    // 2. kite creases from the bottom corner, and the line through their ends
    { id: 'c2l', name: 'crease kite', a: [0, -H], d: [-T, 1], toward: [-H, 0], dur: 0.3 },
    { id: 'c2lu', name: 'unfold', a: [0, -H], d: [-T, 1], toward: [H, 0], only: 'c2l', dur: 0.3 },
    { id: 'c2r', name: 'crease kite', a: [0, -H], d: [T, 1], toward: [H, 0], dur: 0.3 },
    { id: 'c2ru', name: 'unfold', a: [0, -H], d: [T, 1], toward: [-H, 0], only: 'c2r', dur: 0.3 },
    { id: 'c2t', name: 'crease top', a: [0, Y2], d: [1, 0], toward: [0, H], dur: 0.3 },
    { id: 'c2tu', name: 'unfold', a: [0, Y2], d: [1, 0], toward: [0, -H], only: 'c2t', dur: 0.3 },
    // 3. turn over; crease the top and bottom corners to the centre of that line
    { id: 't3', name: 'turn over', turn: true, dur: 0.45 },
    { id: 'c3a', name: 'crease top corner', a: [0, Y3a], d: [1, 0], toward: [0, H], dur: 0.3 },
    { id: 'c3au', name: 'unfold', a: [0, Y3a], d: [1, 0], toward: [0, -H], only: 'c3a', dur: 0.3 },
    { id: 'c3b', name: 'crease bottom corner', a: [0, Y3b], d: [1, 0], toward: [0, -H], dur: 0.3 },
    { id: 'c3bu', name: 'unfold', a: [0, Y3b], d: [1, 0], toward: [0, H], only: 'c3b', dur: 0.3 },
    // 4. the bottom corner up to the lower of those creases: the tail
    { id: 'tail', name: 'tail up', a: [0, Y4], d: [1, 0], toward: [0, -H] },
    // 5. the sides behind, along the kite creases, through every layer
    { id: 'L5', name: 'left side behind', a: [0, -H], d: [-T, 1], toward: [-H, 0], back: true },
    { id: 'R5', name: 'right side behind', a: [0, -H], d: [T, 1], toward: [H, 0], back: true },
    // 6. turn over
    { id: 't6', name: 'turn over', turn: true, dur: 0.45 },
    // 7. the top point down along the line of step 2 ...
    { id: 'top7', name: 'top down', a: [0, Y2], d: [1, 0], toward: [0, H] },
    // ... and at the bottom, slide the layers: the white tail comes out between the flaps
    { id: 'slide7', name: 'slide the tail out', ...slide7(), dur: 1.2 },
    // 8. reverse-fold the top corners, along the lines from the top's midpoint to where
    //    the body's edges cross the horizontal diagonal. Each corner opens between the
    //    point folded down in step 7 and the side flap: the point's corner goes in under
    //    the point, white side up (step 12 shows it), and the flap's and the main
    //    layer's corners come forward to meet it.
    ...[-1, 1].map(s => ({ id: s < 0 ? 'rev8L' : 'rev8R', name: 'reverse-fold corner',
        ...reverse({ a: [0, Y2], d: [s, -1], toward: [s * H, Y2], front: after('top7') }), dur: 0.9 })),
    // 9. (a pinch, not folded here) the bisector at the end of step 3's crease on the
    //    folded-down point, marked only where it crosses the centre line: Y9
    // 10. the top behind, through that mark
    { id: 'top10', name: 'top behind', a: [0, Y9], d: [1, 0], toward: [0, H], back: true },
    // 11. the point folded down in step 7 back up, along step 3's crease as it lies on it;
    //     only its free part, not the corners the reverse folds tucked away
    { id: 'up11', name: 'point up', a: [0, Y11], d: [1, 0], toward: [0, -H],
        filter: p => after('top7')(p) && !after('rev8L', 'rev8R', 'top10')(p) },
    // 12. the ears: pull the corners step 8 tucked into each side's pocket back out,
    //     along a line from the reference point "as far as it will go": until the ear's
    //     inner edge meets the corner of the top edge that step 10 made; any further and
    //     it would have to pass through that fold. (The drawing puts the ear tips 0.170
    //     from the centre line, against 0.169 here; the crease pattern draws this line
    //     about 0.015 lower, which would put them at 0.139.) What swings out is free but
    //     for the fold, so it turns out whole; it pokes out through the pocket's edge, so
    //     it stays inside the pocket and shows only outside it. For the folds along its
    //     hinge to nest, the point's tucked corner stays next to its own layer, and the
    //     main layer's and the flap's corners come out together, the flap wrapping
    //     round the main layer.
    ear(1), ear(-1),
    // 13. the point's tip down to the middle of the sheet: the brow
    { id: 'brow13', name: 'point down', a: [0, Y2 / 2], d: [1, 0], toward: [0, H], filter: after('up11') },
    // 14. (a closer view) 15-17. the eyes, right then left: at each eye's top corner,
    //     reverse-fold the part beyond the bisector. The book's crease pattern doesn't
    //     draw these creases; the drawings and validate() check them.
    ...eye(1), ...eye(-1),
    // 18. pleat the beak (the point folded down in step 13), as the crease pattern has
    //     it: mountain along step 11's line, valley a little lower. A Z: the strip
    //     between the creases turns under the beak's top, and the tip slides up behind it.
    { id: 'pleat18', name: 'pleat the beak', ...pleat18(), dur: 0.9 },
    // 19-22. curve the body, lean the base back, and pleat the tail (above)
    { id: 'shape21', name: 'curve the body', shape: sculpt, dur: 1.6 },
];

// ---------- as the folder sees it -> sheet coords ----------

const flipX = ([x, y]) => [-x, y];
function view(list) {
    let flipped = false;
    return list.map(st => {
        if (st.turn) { flipped = !flipped; return st; }
        if (!flipped) return st;
        const line = l => ({ ...l, a: flipX(l.a), d: flipX(l.d), ...(l.toward && { toward: flipX(l.toward) }) });
        if (st.moves) return { ...st, moves: st.moves.map(m => ({ ...(m.a ? line(m) : m), ...(m.ops && { ops: m.ops.map(line) }), back: !m.back })) };
        return { ...line(st), back: !st.back };
    });
}

const sheetPlan = view(plan);
const index = new Map(sheetPlan.map((st, i) => [st.id, i]));
const movedIn = id => {
    if (!index.has(id)) throw new Error(`owl: no stage '${id}'`);
    const k = index.get(id);
    return p => p.moved.has(k);
};
export const stages = sheetPlan.map(({ id, only, carry, ...st }) => ({
    ...st,
    ...(only && { filter: movedIn(only) }),
    ...(carry && { carry: movedIn(carry) }),
}));

// diagram figure n shows the paper before its own step n: after the stage named here
const figureAfter = {
    1: null, 2: 'c1hu', 3: 't3', 4: 'c3bu', 5: 'tail', 6: 'R5', 7: 't6', 8: 'slide7', 9: 'rev8R', 10: 'rev8R',
    11: 'top10', 12: 'up11', 13: 'ear12L', 14: 'brow13', 15: 'brow13', 17: 'brow13', 18: 'eye17R', 19: 'pleat18',
};
export const figure = Object.fromEntries(Object.entries(figureAfter).map(([n, id]) => [n, id ? index.get(id) + 1 : 0]));

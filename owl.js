// The page folds itself into an owl.
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

import * as THREE from 'three';

const EPS = 0.004;               // paper thickness, in sheet units (the square has side 1)
const CREAM = 0xf8f1e4;
const TERRACOTTA = 0xb85a36;
const INK = 0x2b2721;
const H = Math.SQRT1_2;          // half-diagonal: the square sits corner-up, so the
                                 // folded triangle has base y = 0 and apex y = H

// ---------- crease sequence (model coords, front side toward +z, y up) ----------

const movedIn = (p, k) => p.moved.has(k);
const topLayer = p => movedIn(p, 0);   // the half folded up in step 1: the front layer

// Wing crease k1 (from the tutorial photos): from a point just off the base
// centre up to the shoulder, steep enough that the wing tip ends level with the head.
const K1_BASE = 0.06 * H, K1_DIR = [0.2547, 1];

const stages = [
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
const EYES = [[-0.1 * H, 0.64 * H], [0.1 * H, 0.64 * H]].map(toSheet);
const EYE_R = 0.036 * H;
const BEAK = [[-0.03 * H, 0.625 * H], [0.03 * H, 0.625 * H], [0, 0.596 * H]].map(toSheet);
const BEAK_INK = 0xa94f2e;

// Wing curl (step 14, "gently curl out the wings"): each wing bends as a cylinder
// about an axis through its lower corner at the body, leaning inward at the top,
// so the outer part comes forward and its tip settles slightly downward. Paper
// held inside the body stays flat (the bend fades in over WING_EDGE_FADE outside
// the body edge). The wing is tessellated into strips so the bend is smooth.
const isWing = p => movedIn(p, 6) || movedIn(p, 8);      // the outer wing: bent by the curl
const isWingFlap = p => movedIn(p, 5) || movedIn(p, 7);  // the whole wing flap, pleat included
const WING_AXIS_A = [0.056, 0.054];            // lower corner, right wing (mirror for left)
const WING_AXIS_D = [-0.35, 1];                // axis direction, right wing
const WING_STRIP = 0.06;
const WING_EDGE_FADE = [0.01, 0.10];
const WING_KAPPA = 1.15;                       // curvature at full curl
const bodyEdgeX = y => K1_BASE + K1_DIR[0] * y;   // the k1 crease: body outline

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

function mirror(f, L) {
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

function buildModel() {
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
    for (const sx of [1, -1]) {
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
    // an edge is part of the sheet's outline only if it lies along one side of the square
    const onOutline = (a, b) => {
        const side = q => (Math.abs(Math.abs(q[0]) + Math.abs(q[1]) - H) < 1e-6) ? (Math.sign(q[0]) || 1) * 2 + (Math.sign(q[1]) || 1) : 0;
        const sa = side(a), sb = side(b);
        return sa !== 0 && (sa === sb || Math.abs(a[0]) < 1e-9 || Math.abs(a[1]) < 1e-9 || Math.abs(b[0]) < 1e-9 || Math.abs(b[1]) < 1e-9);
    };
    const edges = [];
    for (const list of edgeMap.values()) {
        if (list.length === 1) {
            const e = list[0], pv = polys[e.pi].v;
            if (onOutline(pv[e.i].p, pv[e.j].p)) edges.push({ ...e, since: -1 });
            continue;
        }
        const [e0, e1] = list;
        const since = firstDifference(polys[e0.pi].moved, polys[e1.pi].moved);
        if (since !== Infinity) edges.push({ ...e0, since }, { ...e1, since });
    }
    return { polys, lines, edges };
}

// ---------- paper texture: cream, with the eyes and beak inked on at the end ----------

function makePaperTexture() {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const hex = c => '#' + c.toString(16).padStart(6, '0');
    const toPx = ([x, y]) => [(x / (2 * H) + 0.5) * size, (0.5 - y / (2 * H)) * size];
    const r = EYE_R / (2 * H) * size;
    const seg = (u, a, b) => clamp((u - a) / (b - a), 0, 1);

    // a marker drawing an eye: outline first, then fill, then the highlight
    function eye(e, v) {
        if (v <= 0) return;
        const [cx, cy] = toPx(e);
        ctx.strokeStyle = ctx.fillStyle = hex(INK);
        ctx.lineCap = 'round';
        ctx.lineWidth = r * 0.5;
        const outline = seg(v, 0, 0.5), fill = seg(v, 0.5, 1);
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.75, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * outline);
        ctx.stroke();
        if (fill > 0) {
            ctx.beginPath(); ctx.arc(cx, cy, r * fill, 0, Math.PI * 2); ctx.fill();
        }
        if (v >= 1) {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(cx - r * 0.33, cy - r * 0.33, r * 0.28, 0, Math.PI * 2); ctx.fill();
        }
    }

    // the beak: the marker runs round the triangle, then fills it
    const beakPx = BEAK.map(toPx);
    function beak(v) {
        if (v <= 0) return;
        const pts = [...beakPx, beakPx[0]];
        const lens = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
        const total = lens.reduce((a, b) => a + b, 0);
        let left = seg(v, 0, 0.7) * total;
        ctx.strokeStyle = ctx.fillStyle = hex(BEAK_INK);
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.lineWidth = r * 0.35;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 0; i < lens.length && left > 0; i++) {
            const f = Math.min(1, left / lens[i]);
            ctx.lineTo(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f);
            left -= lens[i];
        }
        ctx.stroke();
        if (v >= 0.7) {
            ctx.beginPath();
            beakPx.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]));
            ctx.closePath(); ctx.fill();
        }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;

    // u in 0..1: left eye, right eye, then the beak
    function draw(u) {
        ctx.fillStyle = hex(CREAM);
        ctx.fillRect(0, 0, size, size);
        eye(EYES[0], seg(u, 0, 0.36));
        eye(EYES[1], seg(u, 0.36, 0.7));
        beak(seg(u, 0.72, 1));
        tex.needsUpdate = true;
    }
    draw(0);
    return { tex, draw };
}

// ---------- scene ----------

function easeInOut(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function mountOwl(stage, opts = {}) {
    const { polys, lines, edges } = buildModel();
    const nStages = stages.length;

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch (e) {
        return null;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);

    scene.add(new THREE.HemisphereLight(0xfff8ec, 0xa88266, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(-1.2, 2.0, 2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -1.2;
    key.shadow.camera.right = key.shadow.camera.top = 1.2;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 8;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.01;
    key.shadow.radius = 4;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffe9d6, 0.7);
    fill.position.set(1.5, -0.5, 1.5);
    scene.add(fill);

    // a desk behind the sheet that only shows the sheet's shadow
    const desk = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 6),
        new THREE.ShadowMaterial({ opacity: 0.16 })
    );
    desk.position.z = -0.4;
    desk.receiveShadow = true;
    scene.add(desk);

    const triCount = polys.reduce((n, p) => n + p.v.length - 2, 0);
    const positions = new Float32Array(triCount * 9);
    const uvs = new Float32Array(triCount * 6);
    {
        let i = 0;
        const putUV = q => { uvs[i++] = q[0] / (2 * H) + 0.5; uvs[i++] = q[1] / (2 * H) + 0.5; };
        for (const p of polys) {
            const f = p.fAt[0], n = f.length, h = p.hub;
            for (let k = 1; k < n - 1; k++) { putUV(f[h]); putUV(f[(h + k) % n]); putUV(f[(h + k + 1) % n]); }
        }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const paper = makePaperTexture();
    const mat = new THREE.MeshStandardMaterial({
        map: paper.tex, roughness: 0.94, metalness: 0,
        side: THREE.DoubleSide,   // normals are computed per frame: flat on flat paper, smooth on the curled wings
    });
    mat.onBeforeCompile = sh => {
        sh.uniforms.uBack = { value: new THREE.Color(TERRACOTTA) };
        sh.fragmentShader = 'uniform vec3 uBack;\n' + sh.fragmentShader.replace(
            '#include <color_fragment>',
            '#include <color_fragment>\n\tif (!gl_FrontFacing) diffuseColor.rgb = uBack;'
        );
    };

    // push the faces back a hair so the edge lines win the depth test
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 1;
    mat.polygonOffsetUnits = 1;

    const sheet = new THREE.Mesh(geom, mat);
    sheet.castShadow = true;   // onto the desk only: self-shadowing paper-thin layers gives acne
    const group = new THREE.Group();
    group.add(sheet);

    const edgePositions = new Float32Array(edges.length * 6);
    const edgeGeom = new THREE.BufferGeometry();
    edgeGeom.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
    const edgeLines = new THREE.LineSegments(edgeGeom, new THREE.LineBasicMaterial({
        color: INK, transparent: true, opacity: 0.28,
    }));
    group.add(edgeLines);
    scene.add(group);

    const polyOut = new Array(polys.length);   // this frame's 3D corners, per polygon

    const smoothstep = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };

    // bend one wing corner (final flat coords q, current 3D point o) by curl in 0..1
    function curlPoint(q, o, sx, curl) {
        const d = [sx * WING_AXIS_D[0], WING_AXIS_D[1]];
        const len = Math.hypot(d[0], d[1]);
        const n = [sx * d[1] / len, -sx * d[0] / len];
        const ax = sx * WING_AXIS_A[0], ay = WING_AXIS_A[1];
        const s = Math.max(0, (q[0] - ax) * n[0] + (q[1] - ay) * n[1]);
        const w = smoothstep(WING_EDGE_FADE[0], WING_EDGE_FADE[1], Math.abs(q[0]) - bodyEdgeX(q[1]));
        const kappa = WING_KAPPA * curl * w;
        if (kappa < 1e-4 || s <= 0) return o;
        const bx = q[0] - s * n[0], by = q[1] - s * n[1];         // foot on the axis
        const arc = Math.sin(kappa * s) / kappa, lift = (1 - Math.cos(kappa * s)) / kappa;
        return [bx + arc * n[0], by + arc * n[1], o[2] + lift];
    }

    // Average normals across the wing tessellation seams (same layer, same position)
    // so the curl shades as one smooth surface. Real creases are never smoothed.
    const wingTri = [];   // triangle index ranges belonging to each wing layer
    {
        let tri = 0;
        for (const p of polys) {
            const n = p.v.length - 2;
            if (isWing(p)) wingTri.push({ from: tri, to: tri + n, layer: p.layer });
            tri += n;
        }
    }
    function smoothWingNormals() {
        const pos = geom.attributes.position.array, nor = geom.attributes.normal.array;
        const acc = new Map();
        const keyOf = (i, layer) => layer + ':' + pos[i * 3].toFixed(5) + ',' + pos[i * 3 + 1].toFixed(5) + ',' + pos[i * 3 + 2].toFixed(5);
        for (const r of wingTri) for (let v = r.from * 3; v < r.to * 3; v++) {
            const k = keyOf(v, r.layer);
            const a = acc.get(k) || [0, 0, 0];
            a[0] += nor[v * 3]; a[1] += nor[v * 3 + 1]; a[2] += nor[v * 3 + 2];
            acc.set(k, a);
        }
        for (const r of wingTri) for (let v = r.from * 3; v < r.to * 3; v++) {
            const a = acc.get(keyOf(v, r.layer));
            const len = Math.hypot(a[0], a[1], a[2]) || 1;
            nor[v * 3] = a[0] / len; nor[v * 3 + 1] = a[1] / len; nor[v * 3 + 2] = a[2] / len;
        }
        geom.attributes.normal.needsUpdate = true;
    }

    function writePositions(t) {
        const curl = clamp(t - 10, 0, 1) * (opts.curlScale ?? 1);   // the wings curl while the paper turns back
        let K = clamp(Math.floor(t), 0, nStages - 1);
        let prog = clamp(t - K, 0, 1);
        const L = lines[K];
        const th = prog * Math.PI, c = Math.cos(th), s = Math.sin(th);
        let i = 0;
        const put = (x, y, z) => { positions[i++] = x; positions[i++] = y; positions[i++] = z; };
        for (let pi = 0; pi < polys.length; pi++) {
            const p = polys[pi];
            const r = p.rec[K], f = p.fAt[K];
            const z0 = (r.m ? r.lb + (r.la - r.lb) * prog : r.lb) * EPS;
            const out = new Array(f.length);
            for (let k = 0; k < f.length; k++) {
                const q = f[k];
                if (!r.m) { out[k] = [q[0], q[1], z0]; continue; }
                const qx = q[0] - L.a[0], qy = q[1] - L.a[1];
                const par = qx * L.d[0] + qy * L.d[1];
                const px = qx - par * L.d[0], py = qy - par * L.d[1];
                out[k] = [
                    L.a[0] + par * L.d[0] + c * px,
                    L.a[1] + par * L.d[1] + c * py,
                    L.sgn * s * (L.d[0] * py - L.d[1] * px) + z0,
                ];
            }
            if (curl > 0 && isWing(p)) {
                const sx = movedIn(p, 8) ? 1 : -1, fin = p.fAt[nStages];
                for (let k = 0; k < out.length; k++) out[k] = curlPoint(fin[k], out[k], sx, curl);
            }
            const n = out.length, h = p.hub;
            for (let k = 1; k < n - 1; k++) {
                put(...out[h]); put(...out[(h + k) % n]); put(...out[(h + k + 1) % n]);
            }
            polyOut[pi] = out;
        }
        geom.attributes.position.needsUpdate = true;
        geom.computeVertexNormals();
        if (curl > 0) smoothWingNormals();

        let e = 0;
        for (const ed of edges) {
            if (!(ed.since < K || (ed.since === K && prog > 0))) continue;
            const out = polyOut[ed.pi];
            const a = out[ed.i], b = out[ed.j];
            edgePositions[e++] = a[0]; edgePositions[e++] = a[1]; edgePositions[e++] = a[2];
            edgePositions[e++] = b[0]; edgePositions[e++] = b[1]; edgePositions[e++] = b[2];
        }
        edgeGeom.setDrawRange(0, e / 3);
        edgeGeom.attributes.position.needsUpdate = true;
    }

    // how far the paper has been turned over at time t: each turn stage adds a half turn
    function turnAngle(t) {
        let angle = 0;
        stages.forEach((st, k) => {
            if (st.turn) angle += Math.PI * easeInOut(clamp(t - k, 0, 1));
        });
        return angle;
    }

    // ----- sizing -----
    function resize() {
        const w = stage.clientWidth, h = stage.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize);

    // ----- timeline -----
    const START_DELAY = 0.45;
    const durs = stages.map(st => st.dur || 0.5);
    const starts = durs.reduce((acc, d, k) => { acc.push(k ? acc[k - 1] + durs[k - 1] : 0); return acc; }, []);
    const total = starts[nStages - 1] + durs[nStages - 1];
    const fixedT = opts.fixedT;
    let introStart = performance.now();
    let revealed = false;
    let mouse = [0, 0], tilt = [0, 0];
    let visible = true;

    window.addEventListener('pointermove', e => {
        mouse = [e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5];
    }, { passive: true });
    renderer.domElement.addEventListener('click', () => { introStart = performance.now(); });

    if ('IntersectionObserver' in window) {
        new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(stage);
    }

    function introT(now) {
        const sec = clamp((now - introStart) / 1000 - START_DELAY, 0, total);
        let k = 0;
        while (k < nStages - 1 && sec >= starts[k + 1]) k++;
        return k + easeInOut(clamp((sec - starts[k]) / durs[k], 0, 1));
    }
    function scrollT() {
        const p = clamp(window.scrollY / (window.innerHeight * 0.55), 0, 1);
        return nStages * (1 - p);
    }

    let lastT = -1, lastInk = -1;
    let turn = 0;                 // current turn-over angle, eased
    function frame(now) {
        requestAnimationFrame(frame);
        if (!visible) return;
        let t, turnTarget, ink;
        if (fixedT != null) { t = fixedT; turnTarget = turnAngle(t); ink = fixedT >= nStages ? 1 : 0; }
        else {
            const ti = introT(now), ts = scrollT();
            t = Math.min(ti, ts);
            // the eyes and beak are inked on once the last fold has landed; ink stays
            const sec = (now - introStart) / 1000 - START_DELAY;
            ink = clamp((sec - total - 0.15) / 1.5, 0, 1);
            // The wings are folded on the back of the paper, so the timed intro turns
            // the sheet over and back. When scrolling drives the fold instead, the owl
            // must never rest facing away: keep it toward the viewer.
            turnTarget = ts < ti ? 0 : turnAngle(t);
            if (!revealed && ti >= nStages * 0.8) { revealed = true; opts.onReveal && opts.onReveal(); }
        }
        if (t !== lastT) { writePositions(t); lastT = t; }
        if (ink !== lastInk) { paper.draw(ink); lastInk = ink; }

        // ease toward the target along the shortest way round (2 pi and 0 are the same face)
        const TAU = Math.PI * 2;
        let diff = ((turnTarget - turn) % TAU + TAU * 1.5) % TAU - Math.PI;
        turn += diff * 0.25;

        const sec = now / 1000;
        tilt[0] += (mouse[0] - tilt[0]) * 0.05;
        tilt[1] += (mouse[1] - tilt[1]) * 0.05;
        group.rotation.y = turn + tilt[0] * 0.55 + Math.sin(sec * 0.6) * 0.07;
        group.rotation.x = tilt[1] * 0.3 + Math.sin(sec * 0.9) * 0.025;

        // watch the folding from over the shoulder, then settle in front of the owl
        const done = easeInOut(clamp(t / nStages, 0, 1));
        group.position.y = -0.34 * done + Math.sin(sec * 0.8) * 0.012;
        camera.position.set(-1.25 * (1 - done), 1.35 - 1.05 * done, 2.75 - 0.6 * done);
        camera.lookAt(0, -0.02, 0);
        renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);

    return { stages: stages.map(s => s.name) };
}

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

// Eyes, in final model coords on the cream band, mapped back to the sheet:
// the band is the front layer (mirrored by step 1) folded down by step 3.
const EYES = [[-0.1 * H, 0.64 * H], [0.1 * H, 0.64 * H]].map(([x, y]) => {
    const beforeBand = 2 * 0.69 * H - y;     // undo step 3
    return [x, -beforeBand];                 // undo step 1
});
const EYE_R = 0.036 * H;

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

    // flat coordinates of every polygon before each stage
    for (const p of polys) {
        p.fAt = [p.v.map(v => v.p)];
        for (let k = 0; k < stages.length; k++) {
            const prev = p.fAt[k];
            p.fAt[k + 1] = p.rec[k].m ? prev.map(f => mirror(f, lines[k])) : prev;
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
    const edges = [];
    for (const list of edgeMap.values()) {
        if (list.length === 1) { edges.push({ ...list[0], since: -1 }); continue; }
        const [e0, e1] = list;
        const since = firstDifference(polys[e0.pi].moved, polys[e1.pi].moved);
        if (since !== Infinity) edges.push({ ...e0, since }, { ...e1, since });
    }
    return { polys, lines, edges };
}

// ---------- paper texture: cream with the eyes printed on ----------

function makePaperTexture() {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#' + CREAM.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, size, size);
    const toPx = ([x, y]) => [(x / (2 * H) + 0.5) * size, (0.5 - y / (2 * H)) * size];
    for (const e of EYES) {
        const [cx, cy] = toPx(e);
        const r = EYE_R / (2 * H) * size;
        ctx.fillStyle = '#' + INK.toString(16).padStart(6, '0');
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(cx - r * 0.33, cy - r * 0.33, r * 0.28, 0, Math.PI * 2); ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
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
            const f = p.fAt[0];
            for (let k = 1; k < f.length - 1; k++) { putUV(f[0]); putUV(f[k]); putUV(f[k + 1]); }
        }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const mat = new THREE.MeshStandardMaterial({
        map: makePaperTexture(), roughness: 0.94, metalness: 0,
        side: THREE.DoubleSide, flatShading: true,
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

    function writePositions(t) {
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
            for (let k = 1; k < out.length - 1; k++) {
                put(...out[0]); put(...out[k]); put(...out[k + 1]);
            }
            polyOut[pi] = out;
        }
        geom.attributes.position.needsUpdate = true;
        geom.computeVertexNormals();

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

    let lastT = -1;
    function frame(now) {
        requestAnimationFrame(frame);
        if (!visible) return;
        let t;
        if (fixedT != null) t = fixedT;
        else {
            const ti = introT(now);
            t = Math.min(ti, scrollT());
            if (!revealed && ti >= nStages * 0.8) { revealed = true; opts.onReveal && opts.onReveal(); }
        }
        if (t !== lastT) { writePositions(t); lastT = t; }

        const sec = now / 1000;
        tilt[0] += (mouse[0] - tilt[0]) * 0.05;
        tilt[1] += (mouse[1] - tilt[1]) * 0.05;
        group.rotation.y = turnAngle(t) + tilt[0] * 0.55 + Math.sin(sec * 0.6) * 0.07;
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

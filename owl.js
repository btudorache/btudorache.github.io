// The page folds itself into an owl.
//
// A square sheet of two-colour paper (terracotta on the front, cream on the back)
// is folded, one crease at a time, into Hsi-Min Tai's owl (2019): the sheet sits
// corner-up, the chest and crown tuck behind, the wings and cheeks fold back, and
// the chin, ears, eyes and beak are pulled out from between the layers. Every step
// is a hinge rotation about a crease, so the sheet stays one connected piece of paper.
//
// The sheet is a set of convex polygons. Each stage splits the polygons along its
// crease and mirrors the moving side; at render time the moving side is rotated
// about the crease by 0..180 degrees, and completed stages are replayed as mirrors.

import * as THREE from 'three';

const EPS = 0.0025;              // paper thickness, in sheet units (sheet is 1 x 1)
const CREAM = 0xf8f1e4;
const TERRACOTTA = 0xb85a36;

// ---------- crease sequence (sheet coords, terracotta side up, y up) ----------

const movedIn = (p, k) => p.moved.has(k);
const isBase = p => p.moved.size === 0;                       // never folded: the face itself
const onlyMovedIn = (p, k) => p.moved.size === 1 && movedIn(p, k);
// isosceles triangle with apex (ax, ay) and a base of half-width hw on the line y = by
const inTri = (c, ax, ay, by, hw) => {
    const t = (c[1] - ay) / (by - ay);   // 0 at the apex, 1 at the base
    return t > 0 && t < 1 && Math.abs(c[0] - ax) < hw * t;
};

// Each stage: a crease line (point a, direction d), which side moves (toward),
// back: true for a mountain fold, optional seams to cut first, and an optional
// filter picking which layers fold. The chin, ears, eyes and beak move one layer only.
const stages = [
    { name: 'chest',       a: [0, -0.3],         d: [1, 0],          toward: [0, -0.7],    back: true },
    { name: 'crown',       a: [0, 0.3],          d: [1, 0],          toward: [0, 0.7],     back: true },
    // chin: a triangle of the face sinks back, showing the cream chest tucked behind it
    { name: 'chin',        a: [0, -0.1],         d: [1, 0],          toward: [0, -0.3],    back: true,
      cuts: [{ a: [-0.19, -0.1], d: [0.19, -0.2] }, { a: [0.19, -0.1], d: [-0.19, -0.2] }],
      filter: (p, c) => isBase(p) && inTri(c, 0, -0.3, -0.1, 0.19) },
    { name: 'left wing',   a: [-0.44, 0.3],      d: [0.14, -0.6],    toward: [-0.7, 0],    back: true },
    { name: 'right wing',  a: [0.44, 0.3],       d: [-0.14, -0.6],   toward: [0.7, 0],     back: true },
    { name: 'left cheek',  a: [-0.14, -0.3],     d: [-0.3, 0.33],    toward: [-0.5, -0.4], back: true },
    { name: 'right cheek', a: [0.14, -0.3],      d: [0.3, 0.33],     toward: [0.5, -0.4],  back: true },
    // ears: the corners of the crown, pulled out from behind the top edge
    { name: 'ears',        a: [0, 0.3],          d: [1, 0],          toward: [0, 0],
      cuts: [{ a: [-0.18, 0.3], d: [-0.12, -0.107] }, { a: [0.18, 0.3], d: [0.12, -0.107] }],
      filter: (p, c) => onlyMovedIn(p, 1) && Math.abs(c[0]) > 0.18 && c[1] > 0.3 - (Math.abs(c[0]) - 0.18) * 0.892 },
    // eyes: two rounded windows of the face sink back, showing the cream crown behind them
    { name: 'eyes',        a: [0, 0.22],         d: [1, 0],          toward: [0, 0],       back: true,
      cuts: [{ a: [0, 0.15], d: [1, 0] },
             { a: [-0.26, 0.22], d: [0.04, -0.07] }, { a: [-0.06, 0.22], d: [-0.04, -0.07] },
             { a: [0.26, 0.22], d: [-0.04, -0.07] }, { a: [0.06, 0.22], d: [0.04, -0.07] }],
      filter: (p, c) => isBase(p) && c[1] > 0.15 && c[1] < 0.22 &&
          Math.abs(Math.abs(c[0]) - 0.16) < 0.06 + 0.04 * (c[1] - 0.15) / 0.07 },
    // pupils: two small points of the crown, pulled forward into the eyes
    { name: 'pupils',      a: [0, 0.22],         d: [1, 0],          toward: [0, 0.3],
      cuts: [{ a: [-0.19, 0.22], d: [0.03, 0.04] }, { a: [-0.13, 0.22], d: [-0.03, 0.04] },
             { a: [0.19, 0.22], d: [-0.03, 0.04] }, { a: [0.13, 0.22], d: [0.03, 0.04] }],
      filter: (p, c) => onlyMovedIn(p, 1) && (inTri(c, -0.16, 0.26, 0.22, 0.03) || inTri(c, 0.16, 0.26, 0.22, 0.03)) },
    // beak: a small point of the chest, pulled forward onto the chin
    { name: 'beak',        a: [0, -0.1],         d: [1, 0],          toward: [0, 0],
      cuts: [{ a: [-0.035, -0.1], d: [0.035, 0.055] }, { a: [0.035, -0.1], d: [-0.035, 0.055] }],
      filter: (p, c) => onlyMovedIn(p, 0) && inTri(c, 0, -0.045, -0.1, 0.035) },
];

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
    const h = Math.SQRT1_2;   // the sheet sits corner-up
    const square = [[0, -h], [h, 0], [0, h], [-h, 0]];
    let polys = [{ v: square.map(p => ({ p, f: p.slice() })), layer: 0, rec: [], moved: new Set() }];

    const lines = stages.map(lineOf);
    stages.forEach((st, k) => {
        const L = lines[k];
        for (const c of st.cuts || []) {
            const C = lineOf(c);
            polys = polys.flatMap(p => splitPoly(p, C));
        }
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
    return { polys, lines };
}

// ---------- scene ----------

function easeInOut(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function mountOwl(stage, opts = {}) {
    const { polys, lines } = buildModel();
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
    desk.position.z = -0.08;
    desk.receiveShadow = true;
    scene.add(desk);

    const triCount = polys.reduce((n, p) => n + p.v.length - 2, 0);
    const positions = new Float32Array(triCount * 9);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.MeshStandardMaterial({
        color: TERRACOTTA, roughness: 0.94, metalness: 0, side: THREE.DoubleSide, flatShading: true,
    });
    mat.onBeforeCompile = sh => {
        sh.uniforms.uBack = { value: new THREE.Color(CREAM) };
        sh.fragmentShader = 'uniform vec3 uBack;\n' + sh.fragmentShader.replace(
            '#include <color_fragment>',
            '#include <color_fragment>\n\tif (!gl_FrontFacing) diffuseColor.rgb = uBack;'
        );
    };

    const sheet = new THREE.Mesh(geom, mat);
    sheet.castShadow = true;
    const group = new THREE.Group();
    group.add(sheet);
    scene.add(group);

    function writePositions(t) {
        let K = clamp(Math.floor(t), 0, nStages - 1);
        let prog = clamp(t - K, 0, 1);
        const L = lines[K];
        const th = prog * Math.PI, c = Math.cos(th), s = Math.sin(th);
        let i = 0;
        const put = (x, y, z) => { positions[i++] = x; positions[i++] = y; positions[i++] = z; };
        for (const p of polys) {
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
        }
        geom.attributes.position.needsUpdate = true;
        geom.computeVertexNormals();
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
    const STAGE_SEC = 0.5, START_DELAY = 0.45;
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
        const x = clamp((now - introStart) / 1000 - START_DELAY, 0, nStages * STAGE_SEC) / STAGE_SEC;
        const k = Math.floor(x);
        return k >= nStages ? nStages : k + easeInOut(x - k);
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
        group.rotation.y = tilt[0] * 0.55 + Math.sin(sec * 0.6) * 0.07;
        group.rotation.x = tilt[1] * 0.3 + Math.sin(sec * 0.9) * 0.025;
        group.position.y = Math.sin(sec * 0.8) * 0.012;

        // watch the folding from over the shoulder, then settle in front of the owl
        const done = easeInOut(clamp(t / nStages, 0, 1));
        camera.position.set(-1.25 * (1 - done), 1.35 - 1.0 * done, 2.75 - 0.45 * done);
        camera.lookAt(0, -0.02, 0);
        renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);

    return { stages: stages.map(s => s.name) };
}

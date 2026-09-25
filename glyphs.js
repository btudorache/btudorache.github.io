// A small paper object for each interest card: the owl's crease pattern, a lotus
// that breathes, a stack of layers with the top one peeling back, a book turning a
// page. One offscreen WebGL renderer draws all four and each frame is copied into
// the card's own 2D canvas, so the glyphs scroll, fade and lift with their cards
// like any other content, and the page needs one WebGL context for them, not four.
//
// A glyph is { scene, camera, set(now), play(now) }: set poses it for time `now`
// and returns a value that changes whenever the picture does, so a glyph at rest is
// not redrawn; play starts its animation (on first sight, and on hover).

import * as THREE from 'three';
import { COLORS, paperMaterial, addLamp, deskShadowMaterial, clamp, easeInOut, darkScheme, makeRenderer } from './paper.js';
import { H, creasePattern } from './owl-model.js';

const hex = c => '#' + c.toString(16).padStart(6, '0');

function canvasTexture(size, paint) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    paint(ctx, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { tex, ctx, size };
}

// Every glyph sits on the same desk under the same lamp as the owl. The camera
// looks at `target` from `dist` away, `elevation` degrees above the desk, so all
// four are framed by one rule.
function deskScene(target, dist, elevation, fov = 30) {
    const scene = new THREE.Scene();
    const key = addLamp(scene, { shadow: true, mapSize: 512, extent: 1.1 });
    key.shadow.radius = 3;
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), deskShadowMaterial());
    desk.rotation.x = -Math.PI / 2;
    desk.receiveShadow = true;
    scene.add(desk);
    const camera = new THREE.PerspectiveCamera(fov, 1.25, 0.1, 20);
    const e = elevation * Math.PI / 180;
    camera.position.set(target[0], target[1] + dist * Math.sin(e), target[2] + dist * Math.cos(e));
    camera.lookAt(...target);
    return { scene, camera };
}

// Paper edges are inked, as on the owl: a thin line where the paper ends or
// folds. Cream paper on a cream card needs them to read at all. The faces are
// pushed back a hair so the lines win the depth test.
const INK_LINE = new THREE.LineBasicMaterial({ color: COLORS.ink, transparent: true, opacity: 0.3 });
function inked(mat) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 1;
    mat.polygonOffsetUnits = 1;
    return mat;
}
const edgesOf = geo => new THREE.LineSegments(new THREE.EdgesGeometry(geo, 1), INK_LINE);

// the outline of a PlaneGeometry(…, cols, rows) that bends: call update() after
// moving its vertices
function gridOutline(geo, cols, rows) {
    const ring = [];
    for (let i = 0; i <= cols; i++) ring.push(i);
    for (let j = 1; j <= rows; j++) ring.push(j * (cols + 1) + cols);
    for (let i = cols - 1; i >= 0; i--) ring.push(rows * (cols + 1) + i);
    for (let j = rows - 1; j >= 1; j--) ring.push(j * (cols + 1));
    const pos = new Float32Array(ring.length * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const line = new THREE.LineLoop(lineGeo, INK_LINE);
    function update() {
        const src = geo.attributes.position.array;
        ring.forEach((v, k) => { pos[k * 3] = src[v * 3]; pos[k * 3 + 1] = src[v * 3 + 1]; pos[k * 3 + 2] = src[v * 3 + 2]; });
        lineGeo.attributes.position.needsUpdate = true;
        lineGeo.computeBoundingSphere();
    }
    update();
    return { line, update };
}

const once = (duration, now, t0) => t0 == null ? 1 : clamp((now - t0) / duration, 0, 1);

// ---------- origami: the owl at the top of the page, unfolded ----------

// The sheet the owl is folded from, with the crease pattern the fold sequence
// leaves on it (owl-model.js): mountain folds in terracotta, valley folds in blue,
// as seen from the cream side. The creases are drawn in the order they are folded.
// The sheet still holds a little of its first fold, as unfolded paper does.
function origami({ still }) {
    const { scene, camera } = deskScene([0, 0.03, 0.02], 2.35, 56);
    const creases = creasePattern();
    const order = [...new Set(creases.map(c => c.stage))].sort((a, b) => a - b);
    const SIZE = 512;
    const toPx = ([x, y]) => [(x / (2 * H) + 0.5) * SIZE, (0.5 - y / (2 * H)) * SIZE];
    const cp = canvasTexture(SIZE, () => {});
    function paint(u) {           // u: how many stages have been drawn, fractional
        const { ctx } = cp;
        ctx.fillStyle = hex(COLORS.cream);
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.lineCap = 'round';
        ctx.lineWidth = SIZE * 0.0105;
        for (const c of creases) {
            const f = clamp(u - order.indexOf(c.stage), 0, 1);
            if (f <= 0) continue;
            const a = toPx(c.a), b = toPx(c.b);
            ctx.strokeStyle = hex(c.mv === 'M' ? COLORS.terracotta : COLORS.blue);
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f);
            ctx.stroke();
        }
        cp.tex.needsUpdate = true;
    }

    // corner-up square on the desk, its first crease (the horizontal diagonal) along
    // x, each half lifted about it: the valley that crease was folded as
    const K = 0.86, LIFT = 0.18;
    const corners = [[-H, 0], [H, 0], [0, H], [H, 0], [-H, 0], [0, -H]];
    const pos = [], uv = [];
    for (const [x, y] of corners) {
        pos.push(x * K, Math.abs(y) * K * Math.sin(LIFT) + 0.004, -y * K * Math.cos(LIFT));
        uv.push(x / (2 * H) + 0.5, y / (2 * H) + 0.5);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const sheet = new THREE.Mesh(geo, inked(paperMaterial({ map: cp.tex, back: COLORS.terracotta })));
    sheet.castShadow = true;
    scene.add(sheet, edgesOf(geo));

    const PER_STAGE = 280;
    let t0 = null, last = -1;
    return {
        scene, camera,
        play(now) { if (!still && (t0 == null || now - t0 > PER_STAGE * order.length)) t0 = now; },
        set(now) {
            const u = still ? order.length : t0 == null ? 0 : (now - t0) / PER_STAGE;
            const v = clamp(u, 0, order.length);
            if (v !== last) { paint(v); last = v; }
            return v;
        },
    };
}

// ---------- meditation: a paper lotus, breathing ----------

// Two rings of petals, each petal a kite folded along its middle so it cups, hinged
// at its base. They open over a slow inhale and close over the exhale: ten seconds
// a breath, six a minute, the pace slow-breathing practice settles on.
const BREATH = 10000;
function meditation({ still }) {
    const { scene, camera } = deskScene([0, 0.16, 0], 1.62, 34);

    function petalGeometry(L, w, cup) {
        const c = Math.cos(cup), s = Math.sin(cup);
        const base = [0, 0, 0], tip = [0, L, 0];
        const right = [w * c, 0.45 * L, w * s], left = [-w * c, 0.45 * L, w * s];
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute([...base, ...right, ...tip, ...base, ...tip, ...left], 3));
        geo.computeVertexNormals();
        return geo;
    }
    const rings = [
        { n: 8, L: 0.5, w: 0.19, cup: 0.5, r: 0.05, closed: 0.2, open: 1.02, back: COLORS.sage, turn: 0 },
        { n: 6, L: 0.38, w: 0.15, cup: 0.6, r: 0.02, closed: 0.08, open: 0.6, back: 0xa7b48f, turn: Math.PI / 6 },
    ].map(ring => {
        const geo = petalGeometry(ring.L, ring.w, ring.cup);
        const mat = inked(paperMaterial({ front: COLORS.cream, back: ring.back }));
        const edges = new THREE.EdgesGeometry(geo, 1);
        ring.pivots = [];
        for (let i = 0; i < ring.n; i++) {
            const around = new THREE.Group();
            around.rotation.y = ring.turn + i / ring.n * Math.PI * 2;
            const pivot = new THREE.Group();
            pivot.position.z = -ring.r;          // the inner (cream) face looks at the centre
            const petal = new THREE.Mesh(geo, mat);
            petal.castShadow = true;
            pivot.add(petal, new THREE.LineSegments(edges, INK_LINE));
            around.add(pivot);
            scene.add(around);
            ring.pivots.push(pivot);
        }
        return ring;
    });

    let last = -1;
    return {
        scene, camera,
        play() {},
        set(now) {
            const b = still ? 0.6 : 0.5 - 0.5 * Math.cos(now / BREATH * Math.PI * 2);
            if (b === last) return b;
            last = b;
            rings.forEach((ring, k) => {
                const open = clamp(b - k * 0.06, 0, 1);   // the inner ring follows a moment behind
                for (const p of ring.pivots) p.rotation.x = -(ring.closed + (ring.open - ring.closed) * easeInOut(open));
            });
            return b;
        },
    };
}

// ---------- programming: the layers underneath ----------

// A stack of sheets, each printed with a different layer: code, memory, circuitry,
// silicon. The top sheet peels back from its corner to show the one beneath. The
// peel rolls the paper round a cylinder, the way a sheet really lifts.
function programming({ still }) {
    const { scene, camera } = deskScene([0, 0.1, 0.02], 2.3, 42);
    const SL = 0.78, GAP = 0.048, R = 0.07;
    const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

    const code = canvasTexture(512, (ctx, s) => {
        ctx.fillStyle = hex(COLORS.cream); ctx.fillRect(0, 0, s, s);
        const inks = ['rgba(43,39,33,0.55)', hex(COLORS.blue), hex(COLORS.terracotta)];
        let y = s * 0.13, indent = 0;
        while (y < s * 0.86) {
            let x = s * (0.12 + indent * 0.07);
            const words = 1 + Math.floor(rnd() * 4);
            for (let w = 0; w < words && x < s * 0.85; w++) {
                const len = s * (0.05 + rnd() * 0.13);
                ctx.fillStyle = inks[w === 0 ? Math.floor(rnd() * 3) : 0];
                ctx.fillRect(x, y, Math.min(len, s * 0.88 - x), s * 0.028);
                x += len + s * 0.03;
            }
            y += s * 0.062;
            indent = clamp(indent + (rnd() < 0.35 ? 1 : rnd() < 0.4 ? -1 : 0), 0, 3);
        }
    });
    const cells = canvasTexture(256, (ctx, s) => {
        ctx.fillStyle = '#e4e9e8'; ctx.fillRect(0, 0, s, s);
        const n = 8, m = s * 0.1, c = (s - 2 * m) / n;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
            ctx.fillStyle = rnd() < 0.3 ? hex(COLORS.blue) : 'rgba(93,127,157,0.28)';
            ctx.fillRect(m + i * c + c * 0.12, m + j * c + c * 0.12, c * 0.76, c * 0.76);
        }
    });
    const traces = canvasTexture(256, (ctx, s) => {
        ctx.fillStyle = '#9db3c6'; ctx.fillRect(0, 0, s, s);
        ctx.strokeStyle = '#e9eef2'; ctx.fillStyle = '#e9eef2';
        ctx.lineWidth = s * 0.018; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (let k = 0; k < 9; k++) {
            let x = s * (0.1 + rnd() * 0.8), y = s * (0.1 + rnd() * 0.8);
            ctx.beginPath(); ctx.moveTo(x, y);
            for (let t = 0; t < 3; t++) {
                const d = s * (0.1 + rnd() * 0.25);
                if (t % 2) y = clamp(y + (rnd() < 0.5 ? -d : d), s * 0.08, s * 0.92);
                else x = clamp(x + (rnd() < 0.5 ? -d : d), s * 0.08, s * 0.92);
                ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.beginPath(); ctx.arc(x, y, s * 0.028, 0, Math.PI * 2); ctx.fill();
        }
    });
    const silicon = canvasTexture(64, (ctx, s) => {
        ctx.fillStyle = hex(COLORS.blue); ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(s * 0.34, s * 0.34, s * 0.32, s * 0.32);
    });

    const stack = new THREE.Group();
    stack.rotation.y = Math.PI / 4;       // corner toward the viewer
    scene.add(stack);
    [silicon, traces, cells].forEach((t, i) => {
        const geo = new THREE.PlaneGeometry(SL, SL);
        const sheet = new THREE.Mesh(geo, inked(paperMaterial({ map: t.tex, back: COLORS.cream })));
        sheet.add(edgesOf(geo));
        sheet.rotation.x = -Math.PI / 2;
        sheet.position.y = 0.012 + i * GAP;
        sheet.castShadow = sheet.receiveShadow = true;
        stack.add(sheet);
    });

    // the top sheet, tessellated so it can roll
    const top = new THREE.PlaneGeometry(SL, SL, 30, 30);
    top.rotateX(-Math.PI / 2);
    const rest = top.attributes.position.array.slice();
    const topMesh = new THREE.Mesh(top, inked(paperMaterial({ map: code.tex, back: 0xefe7d8 })));
    topMesh.position.y = 0.012 + 3 * GAP;
    topMesh.castShadow = true;
    const topEdge = gridOutline(top, 30, 30);
    topMesh.add(topEdge.line);
    stack.add(topMesh);

    // In the stack's frame the corner nearest the viewer is (-SL/2, SL/2): peel
    // toward it. s runs along the peel, from the far corner to the near one.
    const P = [-Math.SQRT1_2, Math.SQRT1_2], T = [Math.SQRT1_2, Math.SQRT1_2];
    const S_MAX = SL * Math.SQRT1_2, S_MIN = -0.06;
    function peel(p) {
        const c = S_MAX + 0.001 - (S_MAX - S_MIN) * p;       // the line the paper rolls over
        const a = top.attributes.position.array;
        for (let i = 0; i < a.length; i += 3) {
            const x = rest[i], z = rest[i + 2];
            const s = x * P[0] + z * P[1], t = x * T[0] + z * T[1];
            let s2 = s, y = 0;
            const d = s - c;
            if (d > 0) {
                if (d < Math.PI * R) { s2 = c + R * Math.sin(d / R); y = R * (1 - Math.cos(d / R)); }
                else { s2 = c - (d - Math.PI * R); y = 2 * R; }
            }
            a[i] = s2 * P[0] + t * T[0];
            a[i + 1] = y;
            a[i + 2] = s2 * P[1] + t * T[1];
        }
        top.attributes.position.needsUpdate = true;
        top.computeVertexNormals();
        topEdge.update();
    }

    // peel back, hold, lay it down again
    const UP = 1100, HOLD = 1500, DOWN = 1100;
    let t0 = null, last = -1;
    return {
        scene, camera,
        play(now) { if (!still && (t0 == null || now - t0 > UP + HOLD + DOWN)) t0 = now; },
        set(now) {
            let p = 0.55;
            if (!still) {
                const e = t0 == null ? Infinity : Math.max(0, now - t0);
                p = e < UP ? easeInOut(e / UP) : e < UP + HOLD ? 1 : easeInOut(clamp(1 - (e - UP - HOLD) / DOWN, 0, 1));
                p *= 0.78;
            }
            if (p !== last) { peel(p); last = p; }
            return p;
        },
    };
}

// ---------- reading: a book, turning a page ----------

// An open book whose pages rise out of the gutter. A turning page is a curve
// hinged at the spine: its angle sweeps from right to left while the free edge
// lags behind, so the page bows the way paper does in air.
function reading({ still }) {
    const { scene, camera } = deskScene([0, 0.02, 0.03], 2.6, 46);
    const PW = 0.6, PD = 0.8, NU = 28;
    const Y0 = 0.034, GUTTER = 1.0, GL = 0.05;             // height at the spine, how steeply pages leave it

    const rnd = (() => { let s = 11; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    const text = canvasTexture(256, (ctx, s) => {
        ctx.fillStyle = hex(COLORS.cream); ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = 'rgba(43,39,33,0.34)';
        for (let y = s * 0.12; y < s * 0.88; y += s * 0.058) {
            const end = rnd() < 0.15 ? 0.3 + rnd() * 0.4 : 0.84 + rnd() * 0.04;
            ctx.fillRect(s * 0.16, y, s * (end - 0.16), s * 0.024);
        }
    });

    // the page's cross-section for spine angle `alpha` and bend `kappa`
    function curve(alpha, kappa) {
        const pts = [[0, Y0]];
        const du = PW / NU;
        let x = 0, y = Y0;
        for (let i = 0; i < NU; i++) {
            const u = (i + 0.5) * du;
            const phi = alpha + kappa * u + GUTTER * Math.exp(-u / GL) * Math.cos(alpha);
            x += Math.cos(phi) * du; y += Math.sin(phi) * du;
            pts.push([x, y]);
        }
        return pts;
    }
    const pageGeometry = () => new THREE.PlaneGeometry(1, 1, NU, 1);
    function shape(geo, pts, lift) {
        const a = geo.attributes.position.array;
        for (let row = 0; row < 2; row++) for (let i = 0; i <= NU; i++) {
            const k = (row * (NU + 1) + i) * 3;
            a[k] = pts[i][0]; a[k + 1] = pts[i][1] + lift; a[k + 2] = (row ? 0.5 : -0.5) * PD;
        }
        geo.attributes.position.needsUpdate = true;
        geo.computeVertexNormals();
        geo.computeBoundingSphere();
    }

    const pageMat = inked(new THREE.MeshStandardMaterial({ map: text.tex, roughness: 0.94, side: THREE.DoubleSide }));
    const right = curve(0, 0), left = curve(Math.PI, 0);
    for (const pts of [right, left]) {
        const g = pageGeometry();
        shape(g, pts, 0);
        const m = new THREE.Mesh(g, pageMat);
        m.receiveShadow = true;
        scene.add(m, gridOutline(g, NU, 1).line);
    }

    // the page blocks under them and the covers under those
    const edgeX = right[NU][0];
    let blockTop = Infinity;
    for (const [x, y] of right) if (x > 0.07) blockTop = Math.min(blockTop, y);
    const blockMat = new THREE.MeshStandardMaterial({ color: 0xeee4d1, roughness: 0.95 });
    const coverMat = new THREE.MeshStandardMaterial({ color: 0xa9803a, roughness: 0.85 });
    for (const sx of [-1, 1]) {
        const h = blockTop - 0.02 - 0.003;
        const block = new THREE.Mesh(new THREE.BoxGeometry(edgeX - 0.07, h, PD - 0.01), blockMat);
        block.position.set(sx * (0.07 + (edgeX - 0.07) / 2), 0.02 + h / 2, 0);
        block.castShadow = true;
        scene.add(block);
        const coverGeo = new THREE.BoxGeometry(edgeX + 0.03, 0.02, PD + 0.05);
        const cover = new THREE.Mesh(coverGeo, coverMat);
        cover.position.set(sx * (edgeX + 0.03) / 2, 0.01, 0);
        cover.castShadow = cover.receiveShadow = true;
        cover.add(edgesOf(coverGeo));
        scene.add(cover);
    }

    const turning = pageGeometry();
    const turnMesh = new THREE.Mesh(turning, pageMat);
    turnMesh.castShadow = true;
    const turnEdge = gridOutline(turning, NU, 1);
    scene.add(turnMesh, turnEdge.line);

    const TURN = 1500;
    let t0 = null, last = -1;
    return {
        scene, camera,
        play(now) { if (!still && (t0 == null || now - t0 > TURN)) t0 = now; },
        set(now) {
            const p = still ? 0 : easeInOut(once(TURN, now, t0));
            if (p === last) return p;
            last = p;
            shape(turning, curve(Math.PI * p, -1.8 * Math.sin(Math.PI * p)), 0.004);
            turnEdge.update();
            return p;
        },
    };
}

const BUILD = { origami, meditation, programming, reading };

// slots: [{ el, kind, card }] — el receives the canvas, card is what hovering replays
export async function mountGlyphs(slots, { still = false } = {}) {
    const renderer = makeRenderer();
    if (!renderer) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x000000, 0);

    const glyphs = slots.map(slot => BUILD[slot.kind]({ still }));
    for (const g of glyphs) await renderer.compileAsync(g.scene, g.camera);
    const views = slots.map((slot, i) => {
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        slot.el.appendChild(canvas);
        const g = glyphs[i];
        const view = { ...slot, canvas, ctx: canvas.getContext('2d'), g, visible: false, seen: false, key: null };
        const replay = () => g.play(performance.now());
        slot.card.addEventListener('pointerenter', replay);
        slot.card.addEventListener('focusin', replay);
        return view;
    });

    // Each glyph is drawn at its own slot's size into the bottom-left corner of a
    // renderer big enough for the largest slot, then copied out of that corner.
    function resize() {
        let maxW = 1, maxH = 1;
        for (const v of views) {
            v.w = v.el.clientWidth; v.h = v.el.clientHeight;
            maxW = Math.max(maxW, v.w); maxH = Math.max(maxH, v.h);
        }
        renderer.setSize(maxW, maxH, false);
        for (const v of views) {
            if (!v.w || !v.h) continue;
            // floor, as three.js sizes its own canvas
            v.canvas.width = Math.floor(v.w * dpr);
            v.canvas.height = Math.floor(v.h * dpr);
            v.g.camera.aspect = v.w / v.h;
            v.g.camera.updateProjectionMatrix();
            v.key = null;
        }
    }
    resize();
    const ro = new ResizeObserver(resize);
    views.forEach(v => ro.observe(v.el));
    // the desk shadow follows the colour scheme: draw everything again
    darkScheme.addEventListener('change', () => views.forEach(v => { v.key = null; }));

    renderer.setScissorTest(true);
    function render(v) {
        renderer.setViewport(0, 0, v.w, v.h);
        renderer.setScissor(0, 0, v.w, v.h);
        renderer.render(v.g.scene, v.g.camera);
        const src = renderer.domElement, w = v.canvas.width, h = v.canvas.height;
        v.ctx.clearRect(0, 0, w, h);
        v.ctx.drawImage(src, 0, src.height - h, w, h, 0, 0, w, h);
    }

    const io = new IntersectionObserver(entries => {
        for (const e of entries) {
            const v = views.find(v => v.el === e.target);
            v.visible = e.isIntersecting;
            // play each once, when it is first properly in view
            if (e.intersectionRatio >= 0.6 && !v.seen) { v.seen = true; v.g.play(performance.now() + 250); }
        }
    }, { threshold: [0, 0.6] });
    views.forEach(v => io.observe(v.el));

    const loop = now => {
        requestAnimationFrame(loop);
        for (const v of views) {
            if (!v.visible || !v.w || !v.h) continue;
            const key = v.g.set(now);
            if (key === v.key) continue;
            v.key = key;
            render(v);
        }
    };
    requestAnimationFrame(loop);
    return {};
}

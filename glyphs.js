// A small object for each interest card: the owl's crease pattern, a lotus that
// breathes, a chip whose lid lifts off, a book turning a page. One offscreen WebGL
// renderer draws all four and each frame is copied into the card's own 2D canvas,
// so the glyphs scroll, fade and lift with their cards like any other content, and
// the page needs one WebGL context for them, not four.
//
// A glyph is { scene, camera, set(now), play(now) }: set poses it for time `now`
// and returns a value that changes whenever the picture does, so a glyph at rest is
// not redrawn; play starts its animation (on first sight, and on hover).

import * as THREE from 'three';
import { COLORS, paperMaterial, addLamp, deskShadowMaterial, clamp, easeInOut, smoothstep, darkScheme, makeRenderer } from './paper.js';
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

// The lotus and the chip aren't paper: petals have a sheen, and metal and silicon
// look black unless there is something around them to reflect. This is that
// something: the lamp's lights as bright panels in a dim, warm room, blurred into
// an environment map. Built once, on the shared renderer.
function studio(renderer) {
    const room = new THREE.Scene();
    room.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: 0x4a433b, side: THREE.BackSide })));
    const panel = (w, h, power, at, color = 0xffffff) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
            color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide,
        }));
        m.position.set(...at);
        m.lookAt(0, 0, 0);
        room.add(m);
    };
    panel(3.5, 3.5, 7, [-2.2, 3.6, 4.4]);              // the key light, upper left (addLamp)
    panel(6, 6, 2.2, [0, 4.9, 0], 0xfff4e0);            // the ceiling
    panel(2.5, 4, 1.6, [4.6, 0.4, 2.2], 0xffe9d6);      // the fill, from the right
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose();
    return env;
}

function roundedSquare(side, r) {
    const h = side / 2, s = new THREE.Shape();
    s.moveTo(-h + r, -h);
    s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r);
    s.lineTo(h, h - r); s.quadraticCurveTo(h, h, h - r, h);
    s.lineTo(-h + r, h); s.quadraticCurveTo(-h, h, -h, h - r);
    s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h);
    return s;
}

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

// ---------- meditation: a lotus, breathing ----------

// A pink lotus on its leaf: three rings of petals around the seed pod and its
// fringe of stamens. Each petal is cupped across and curls in toward its tip, pale
// at the base and deepening to pink. The petals open over a slow inhale and close
// over the exhale: ten seconds a breath, six a minute, the pace slow-breathing
// practice settles on.
const BREATH = 10000;
function meditation({ still, env }) {
    const { scene, camera } = deskScene([0, 0.11, 0], 1.78, 37);
    scene.environment = env;
    scene.environmentIntensity = 0.55;
    const FLOWER_Y = 0.035;

    const petalTex = canvasTexture(256, (ctx, s) => {
        const g = ctx.createLinearGradient(0, s, 0, 0);      // base (bottom) to tip (top)
        g.addColorStop(0, '#fff8f0');
        g.addColorStop(0.3, '#fde6e8');
        g.addColorStop(0.68, '#f4a0ba');
        g.addColorStop(1, '#d8457b');
        ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
        const e = ctx.createLinearGradient(0, 0, s, 0);      // the edges blush pinker than the middle
        e.addColorStop(0, 'rgba(222,84,132,0.5)'); e.addColorStop(0.28, 'rgba(222,84,132,0)');
        e.addColorStop(0.72, 'rgba(222,84,132,0)'); e.addColorStop(1, 'rgba(222,84,132,0.5)');
        ctx.fillStyle = e; ctx.fillRect(0, 0, s, s);
        // veins run the petal's length; its taper gathers them at the tip
        ctx.strokeStyle = 'rgba(196,58,108,0.2)'; ctx.lineWidth = s * 0.009;
        for (let i = 1; i < 12; i++) {
            ctx.beginPath(); ctx.moveTo(i / 12 * s, s); ctx.lineTo(i / 12 * s, 0); ctx.stroke();
        }
    });
    const petalMat = new THREE.MeshPhysicalMaterial({
        map: petalTex.tex, roughness: 0.5, side: THREE.DoubleSide,
        sheen: 1, sheenRoughness: 0.45, sheenColor: 0xffe3ec,
        // a little light of its own: petals are thin, and glow where the lamp shines through
        emissive: 0xffffff, emissiveMap: petalTex.tex, emissiveIntensity: 0.14,
    });

    // L long, W at its widest (a little past the middle), with a pointed tip. The
    // midrib rises along +y and curls toward +z, the flower's centre; the sides
    // cup toward it too.
    function petalGeometry(L, W, cup, curl) {
        const NU = 14, NV = 8, pos = [], uv = [], index = [];
        let y = 0, z = 0;
        for (let i = 0; i <= NU; i++) {
            const u = i / NU, a = curl * u * u;
            const w = W * (0.25 * (1 - u) + 0.75 * Math.sin(Math.PI * Math.pow(u, 1.35)));
            for (let j = 0; j <= NV; j++) {
                const v = j / NV * 2 - 1, c = cup * w * v * v;
                pos.push(w * v, y - c * Math.sin(a), z + c * Math.cos(a));
                uv.push((v + 1) / 2, u);
            }
            y += Math.cos(a) * L / NU; z += Math.sin(a) * L / NU;
        }
        for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
            const k = i * (NV + 1) + j;
            index.push(k, k + 1, k + NV + 1, k + 1, k + NV + 2, k + NV + 1);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(index);
        geo.computeVertexNormals();
        return geo;
    }
    // angles are from upright; the outer petals open widest, the inner ones stay
    // wrapped round the pod
    const rings = [
        { n: 8, L: 0.44, W: 0.155, cup: 0.55, curl: 0.55, r: 0.06, closed: 0.42, open: 1.2, turn: 0 },
        { n: 8, L: 0.4, W: 0.145, cup: 0.6, curl: 0.65, r: 0.05, closed: 0.24, open: 0.82, turn: Math.PI / 8 },
        { n: 6, L: 0.31, W: 0.12, cup: 0.7, curl: 0.75, r: 0.04, closed: 0.1, open: 0.42, turn: Math.PI / 6 },
    ].map(ring => {
        const geo = petalGeometry(ring.L, ring.W, ring.cup, ring.curl);
        ring.pivots = [];
        for (let i = 0; i < ring.n; i++) {
            const around = new THREE.Group();
            around.rotation.y = ring.turn + i / ring.n * Math.PI * 2;
            around.position.y = FLOWER_Y;
            const pivot = new THREE.Group();
            pivot.position.z = -ring.r;          // the petal's inner face looks at the centre
            const petal = new THREE.Mesh(geo, petalMat);
            petal.castShadow = petal.receiveShadow = true;
            pivot.add(petal);
            around.add(pivot);
            scene.add(around);
            ring.pivots.push(pivot);
        }
        return ring;
    });

    // the seed pod: a flat-topped cone with seeds sunk in its top
    const podTop = canvasTexture(128, (ctx, s) => {
        ctx.fillStyle = '#d7d45e'; ctx.fillRect(0, 0, s, s);
        const pits = [[0, 0]];
        for (const [n, r] of [[6, 0.2], [11, 0.37]]) for (let i = 0; i < n; i++) pits.push([r * Math.cos(i / n * Math.PI * 2), r * Math.sin(i / n * Math.PI * 2)]);
        for (const [x, y] of pits) {
            ctx.fillStyle = '#eeea8a'; ctx.beginPath(); ctx.arc(s * (0.5 + x), s * (0.5 + y) + s * 0.012, s * 0.058, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#8c9030'; ctx.beginPath(); ctx.arc(s * (0.5 + x), s * (0.5 + y), s * 0.05, 0, Math.PI * 2); ctx.fill();
        }
    });
    const podSide = new THREE.MeshStandardMaterial({ color: 0xbfc657, roughness: 0.6 });
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.036, 0.06, 32),
        [podSide, new THREE.MeshStandardMaterial({ map: podTop.tex, roughness: 0.6 }), podSide]);
    pod.position.y = FLOWER_Y + 0.045;
    pod.castShadow = pod.receiveShadow = true;
    scene.add(pod);

    // stamens: pale filaments splaying out from under the pod, golden anthers at their tips
    const N_STAMENS = 54;
    const filaments = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0022, 0.0022, 1, 4), new THREE.MeshStandardMaterial({ color: 0xf5dc86, roughness: 0.7 }), N_STAMENS);
    const anthers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0055, 6, 4), new THREE.MeshStandardMaterial({ color: 0xf0b023, roughness: 0.6 }), N_STAMENS);
    {
        const rnd = (() => { let s = 5; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
        const o = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), base = new THREE.Vector3();
        for (let i = 0; i < N_STAMENS; i++) {
            const a = (i + rnd() * 0.6) / N_STAMENS * Math.PI * 2, lean = 0.55 + rnd() * 0.4, len = 0.05 + rnd() * 0.02;
            base.set(0.045 * Math.cos(a), FLOWER_Y + 0.02, 0.045 * Math.sin(a));
            dir.set(Math.sin(lean) * Math.cos(a), Math.cos(lean), Math.sin(lean) * Math.sin(a));
            o.quaternion.setFromUnitVectors(up, dir);
            o.position.copy(base).addScaledVector(dir, len / 2);
            o.scale.set(1, len, 1);
            o.updateMatrix();
            filaments.setMatrixAt(i, o.matrix);
            o.position.copy(base).addScaledVector(dir, len);
            o.scale.set(1, 2, 1);
            o.updateMatrix();
            anthers.setMatrixAt(i, o.matrix);
        }
    }
    filaments.castShadow = anthers.castShadow = true;
    scene.add(filaments, anthers);

    // the leaf: round, as a lotus leaf is, its rim lifting and rippling, veins
    // radiating from where the stalk meets it
    const LEAF = 0.46;
    const leafTex = canvasTexture(256, (ctx, s) => {
        const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        g.addColorStop(0, '#a6c46a'); g.addColorStop(0.18, '#78a346'); g.addColorStop(0.8, '#4f8033'); g.addColorStop(1, '#46732d');
        ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
        ctx.strokeStyle = 'rgba(214,232,168,0.26)'; ctx.lineCap = 'round';
        for (let i = 0; i < 21; i++) {
            const a = i / 21 * Math.PI * 2;
            ctx.lineWidth = s * 0.007;
            ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2 + Math.cos(a) * s * 0.49, s / 2 + Math.sin(a) * s * 0.49); ctx.stroke();
            ctx.lineWidth = s * 0.004;      // each vein forks near the rim
            for (const d of [-0.07, 0.07]) {
                ctx.beginPath(); ctx.moveTo(s / 2 + Math.cos(a) * s * 0.3, s / 2 + Math.sin(a) * s * 0.3);
                ctx.lineTo(s / 2 + Math.cos(a + d) * s * 0.49, s / 2 + Math.sin(a + d) * s * 0.49); ctx.stroke();
            }
        }
    });
    const leafGeo = new THREE.RingGeometry(0, LEAF, 72, 8);
    leafGeo.rotateX(-Math.PI / 2);
    {
        const a = leafGeo.attributes.position.array;
        for (let i = 0; i < a.length; i += 3) {
            const r = Math.hypot(a[i], a[i + 2]) / LEAF, th = Math.atan2(a[i + 2], a[i]);
            a[i + 1] = 0.01 + 0.07 * Math.pow(r, 3) + 0.018 * Math.pow(r, 4) * Math.sin(7 * th + 1.3);
        }
        leafGeo.computeVertexNormals();
    }
    const leaf = new THREE.Mesh(leafGeo, new THREE.MeshStandardMaterial({ map: leafTex.tex, roughness: 0.55, side: THREE.DoubleSide }));
    leaf.position.z = -0.04;
    leaf.castShadow = leaf.receiveShadow = true;
    scene.add(leaf);

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

// ---------- programming: a chip, opened ----------

// A 44-pin chip (a quad flat package) on a blue circuit board, its traces fanning
// out from the pins. Played, the top of the package lifts off and sets itself
// back to show the layer most people never look at: the silicon die, wired to
// the leads by gold bond wires.
function programming({ still, env }) {
    const { scene, camera } = deskScene([0, 0.085, 0.0], 1.84, 42);
    scene.environment = env;
    scene.environmentIntensity = 0.8;
    const chip = new THREE.Group();
    chip.rotation.y = -0.42;
    scene.add(chip);

    const B = 0.74, BT = 0.028;                          // board: side, thickness
    const C = 0.36, STAND = 0.005, HB = 0.02, HL = 0.026; // package: side, standoff, base and lid heights
    const PINS = 11, PITCH = 0.025, LEAD = 0.058;       // leads per side, their spacing and reach
    const D = 0.11;                                     // the die's side
    const PART = STAND + HB;                            // the mould's parting line, where the leads come out
    const sides = [0, 1, 2, 3].map(k => {
        const a = k * Math.PI / 2;
        return { a, o: [Math.cos(a), -Math.sin(a)], t: [Math.sin(a), Math.cos(a)] };
    });
    const pins = [];                                    // [side, offset along it]
    for (const s of sides) for (let j = 0; j < PINS; j++) pins.push([s, (j - (PINS - 1) / 2) * PITCH]);
    const at = (s, r, off) => [s.o[0] * r + s.t[0] * off, s.o[1] * r + s.t[1] * off];   // board (x, z)

    // ----- the board: solder mask over copper traces, gold pads, white silkscreen -----
    const S = 512;
    const px = ([x, z]) => [(x / B + 0.5) * S, (z / B + 0.5) * S];
    const W = w => w / B * S;
    const pads = [];                                    // [corners] in board coordinates
    const rect = (s, r0, r1, off, w) => [at(s, r0, off - w / 2), at(s, r1, off - w / 2), at(s, r1, off + w / 2), at(s, r0, off + w / 2)];
    for (const [s, off] of pins) pads.push(rect(s, C / 2 + 0.026, C / 2 + 0.064, off, 0.016));
    const caps = [[0.28, 0.29, 0], [-0.29, 0.28, Math.PI / 2], [0.29, -0.28, Math.PI / 2]];
    for (const [x, z, a] of caps) for (const e of [-1, 1]) {
        const c = Math.cos(a), sn = Math.sin(a), cx = x + e * 0.024 * c, cz = z - e * 0.024 * sn;
        pads.push([[-0.014, -0.016], [0.014, -0.016], [0.014, 0.016], [-0.014, 0.016]].map(([u, v]) => [cx + u * c + v * sn, cz - u * sn + v * c]));
    }
    const vias = [];
    const traces = pins.map(([s, off], i) => {
        const r2 = C / 2 + 0.08, r3 = r2 + 0.5 * Math.abs(off), spread = 1.5 * off;
        const path = [at(s, C / 2 + 0.064, off), at(s, r2, off), at(s, r3, spread)];
        if (i % 3 === 1) { const v = at(s, r3 + 0.03, spread); path.push(v); vias.push(v); }
        else path.push(at(s, B / 2 + 0.01, spread));
        return path;
    });
    vias.push([-0.3, -0.3], [-0.245, -0.325]);
    const fillPoly = (ctx, pts) => { ctx.beginPath(); pts.forEach((p, k) => ctx[k ? 'lineTo' : 'moveTo'](...px(p))); ctx.closePath(); ctx.fill(); };
    const dot = (ctx, p, r) => { ctx.beginPath(); ctx.arc(...px(p), W(r), 0, Math.PI * 2); ctx.fill(); };
    const board = canvasTexture(S, ctx => {
        ctx.fillStyle = '#1b4a80'; ctx.fillRect(0, 0, S, S);
        ctx.strokeStyle = '#2d67a6'; ctx.lineWidth = W(0.009); ctx.lineJoin = ctx.lineCap = 'round';
        for (const path of traces) { ctx.beginPath(); path.forEach((p, k) => ctx[k ? 'lineTo' : 'moveTo'](...px(p))); ctx.stroke(); }
        ctx.fillStyle = '#d9b45c';
        for (const p of pads) fillPoly(ctx, p);
        for (const v of vias) dot(ctx, v, 0.012);
        ctx.fillStyle = '#0f2540';
        for (const v of vias) dot(ctx, v, 0.005);
        // silkscreen: the package's corners, pin 1's dot, the part's name
        ctx.strokeStyle = '#eef0ea'; ctx.fillStyle = '#eef0ea'; ctx.lineWidth = W(0.006); ctx.lineCap = 'butt';
        const h = C / 2 + 0.012, arm = 0.03;
        for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            ctx.beginPath(); ctx.moveTo(...px([sx * h, sz * (h - arm)])); ctx.lineTo(...px([sx * h, sz * h])); ctx.lineTo(...px([sx * (h - arm), sz * h])); ctx.stroke();
        }
        dot(ctx, [-h - 0.02, -h - 0.02], 0.009);
        ctx.font = `600 ${W(0.045)}px sans-serif`;
        ctx.fillText('U1', ...px([-0.322, -0.212]));
    });
    const boardMetal = canvasTexture(S, ctx => {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
        ctx.fillStyle = '#fff';
        for (const p of pads) fillPoly(ctx, p);
        for (const v of vias) dot(ctx, v, 0.012);
    });
    for (const t of [board.tex, boardMetal.tex]) { t.repeat.set(1 / B, 1 / B); t.offset.set(0.5, 0.5); }
    boardMetal.tex.colorSpace = THREE.NoColorSpace;
    const boardGeo = new THREE.ExtrudeGeometry(roundedSquare(B, 0.045), { depth: BT, bevelEnabled: false, curveSegments: 6 });
    boardGeo.rotateX(-Math.PI / 2);
    const boardMesh = new THREE.Mesh(boardGeo, [
        new THREE.MeshStandardMaterial({ map: board.tex, metalness: 1, metalnessMap: boardMetal.tex, roughness: 0.4 }),
        new THREE.MeshStandardMaterial({ color: 0xcabd8b, roughness: 0.85 }),     // the fibreglass edge
    ]);
    boardMesh.receiveShadow = true;
    chip.add(boardMesh);
    const onBoard = new THREE.Group();
    onBoard.position.y = BT;
    chip.add(onBoard);

    // decoupling capacitors, as every chip has beside it
    const capBody = new THREE.MeshStandardMaterial({ color: 0xc4a377, roughness: 0.7 });
    const tin = new THREE.MeshStandardMaterial({ color: 0xd4d7dc, metalness: 1, roughness: 0.32 });
    for (const [x, z, a] of caps) {
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        g.rotation.y = a;
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.024), capBody);
        body.position.y = 0.011;
        g.add(body);
        for (const e of [-1, 1]) {
            const end = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.023, 0.025), tin);
            end.position.set(e * 0.0205, 0.0115, 0);
            g.add(end);
        }
        g.traverse(m => { m.castShadow = true; });
        onBoard.add(g);
    }

    // ----- the package: a black epoxy base and lid, gull-wing leads -----
    const epoxy = new THREE.MeshStandardMaterial({ color: 0x1d1d20, roughness: 0.55 });
    function slab(h) {
        const bevel = 0.003, g = new THREE.ExtrudeGeometry(roundedSquare(C - 0.008, 0.008),
            { depth: h - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: 0.004, bevelSegments: 2, curveSegments: 4 });
        g.rotateX(-Math.PI / 2);
        g.translate(0, bevel, 0);
        return g;
    }
    const base = new THREE.Group();
    base.position.y = STAND;
    onBoard.add(base);
    const baseMesh = new THREE.Mesh(slab(HB), epoxy);
    baseMesh.castShadow = baseMesh.receiveShadow = true;
    base.add(baseMesh);

    const T = 0.0055, y0 = PART - T / 2;                // a lead's side view: out, down, and a foot on its pad
    const leadShape = new THREE.Shape([[-0.004, y0], [0.014, y0], [0.03, 0], [LEAD, 0], [LEAD, T], [0.034, T], [0.018, y0 + T], [-0.004, y0 + T]].map(p => new THREE.Vector2(...p)));
    const leadGeo = new THREE.ExtrudeGeometry(leadShape, { depth: 0.011, bevelEnabled: false });
    leadGeo.translate(0, 0, -0.0055);
    const leads = new THREE.InstancedMesh(leadGeo, tin, pins.length);
    {
        const o = new THREE.Object3D();
        pins.forEach(([s, off], i) => {
            const [x, z] = at(s, C / 2, off);
            o.position.set(x, 0, z);
            o.rotation.y = s.a;
            o.updateMatrix();
            leads.setMatrixAt(i, o.matrix);
        });
    }
    leads.castShadow = true;
    onBoard.add(leads);

    // inside: the lead frame's fingers reach in toward the die on its paddle
    const IN = C - 0.012, tip = off => off * 0.6;
    const ipx = ([x, z]) => [(x / IN + 0.5) * 256, (z / IN + 0.5) * 256];
    const frame = paint => canvasTexture(256, ctx => {
        ctx.fillStyle = paint ? '#141416' : '#000'; ctx.fillRect(0, 0, 256, 256);
        ctx.fillStyle = paint ? '#b4b7be' : '#fff';
        const q = D / 2 + 0.012;
        ctx.fillRect(...ipx([-q, -q]), q / IN * 512, q / IN * 512);
        for (const [s, off] of pins) {
            const w = 0.009, a = at(s, IN / 2, off), b = at(s, 0.085, tip(off));
            const n = [s.t[0] * w / 2, s.t[1] * w / 2];
            ctx.beginPath();
            for (const p of [[a[0] - n[0], a[1] - n[1]], [b[0] - n[0] * 0.7, b[1] - n[1] * 0.7], [b[0] + n[0] * 0.7, b[1] + n[1] * 0.7], [a[0] + n[0], a[1] + n[1]]]) ctx.lineTo(...ipx(p));
            ctx.closePath(); ctx.fill();
        }
    });
    const inside = frame(true), insideMetal = frame(false);
    insideMetal.tex.colorSpace = THREE.NoColorSpace;
    const insideGeo = new THREE.PlaneGeometry(IN, IN);
    insideGeo.rotateX(-Math.PI / 2);
    const insideMesh = new THREE.Mesh(insideGeo, new THREE.MeshStandardMaterial({
        map: inside.tex, metalness: 1, metalnessMap: insideMetal.tex, roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -1,
    }));
    insideMesh.position.y = HB;
    insideMesh.receiveShadow = true;
    base.add(insideMesh);

    // the die: blocks of memory and logic, bond pads round its edge
    const die = canvasTexture(256, (ctx, s) => {
        const rnd = (() => { let v = 3; return () => (v = (v * 16807) % 2147483647) / 2147483647; })();
        ctx.fillStyle = '#4b5365'; ctx.fillRect(0, 0, s, s);
        ctx.strokeStyle = '#a4a9b3'; ctx.lineWidth = s * 0.02; ctx.strokeRect(s * 0.02, s * 0.02, s * 0.96, s * 0.96);
        const block = (x, y, w, h, color, lines, vertical) => {
            ctx.fillStyle = color; ctx.fillRect(x * s, y * s, w * s, h * s);
            ctx.fillStyle = 'rgba(255,255,255,0.16)';
            for (let k = 0; k < (vertical ? w : h) * s; k += lines) vertical ? ctx.fillRect(x * s + k, y * s, 1.2, h * s) : ctx.fillRect(x * s, y * s + k, w * s, 1.2);
        };
        block(0.14, 0.14, 0.34, 0.3, '#6878a6', 4, false);   // memory
        block(0.52, 0.14, 0.34, 0.3, '#7a6aa0', 4, true);
        block(0.14, 0.72, 0.2, 0.14, '#9c8a58', 6, false);   // analog, the odd one out
        for (let k = 0; k < 160; k++) {                      // logic
            ctx.fillStyle = ['#667a6e', '#7d8a6b', '#6c7794', '#5b6a78'][k % 4];
            ctx.fillRect(s * (0.38 + rnd() * 0.44), s * (0.5 + rnd() * 0.33), s * (0.02 + rnd() * 0.06), s * (0.02 + rnd() * 0.05));
        }
        ctx.fillStyle = '#d6d8dc';
        for (let j = 0; j < PINS; j++) {
            const u = 0.13 + j * 0.074;
            for (const [x, y] of [[u, 0.06], [u, 0.9], [0.06, u], [0.9, u]]) ctx.fillRect(x * s, y * s, s * 0.045, s * 0.045);
        }
    });
    const dieEdge = new THREE.MeshStandardMaterial({ color: 0x6b6f78, metalness: 0.4, roughness: 0.4 });
    const dieTop = new THREE.MeshPhysicalMaterial({
        map: die.tex, metalness: 0.5, roughness: 0.28,
        iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [200, 700],   // the oxide's rainbow sheen
    });
    const dieMesh = new THREE.Mesh(new THREE.BoxGeometry(D, 0.006, D), [dieEdge, dieEdge, dieTop, dieEdge, dieEdge, dieEdge]);
    dieMesh.position.y = HB + 0.003;
    dieMesh.receiveShadow = true;
    base.add(dieMesh);

    // bond wires: an arc from each pad on the die to its finger
    const wire = [];
    const DIE_TOP = HB + 0.006;
    for (const [s, off] of pins) {
        const a = at(s, D / 2 - 0.007, off * 0.36), b = at(s, 0.09, tip(off));
        const c = [a[0] + (b[0] - a[0]) * 0.3, a[1] + (b[1] - a[1]) * 0.3];
        let prev = null;
        for (let k = 0; k <= 8; k++) {
            const u = k / 8, m = (1 - u) * (1 - u), n = 2 * u * (1 - u), l = u * u;
            const p = [m * a[0] + n * c[0] + l * b[0], m * DIE_TOP + n * (DIE_TOP + 0.03) + l * (HB + 0.0005), m * a[1] + n * c[1] + l * b[1]];
            if (prev) wire.push(...prev, ...p);
            prev = p;
        }
    }
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    base.add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0xf3c65a })));

    // the lid, with its maker's marks: pin 1's dimple and a part number
    const lid = new THREE.Group();
    onBoard.add(lid);
    const lidMesh = new THREE.Mesh(slab(HL), epoxy);
    lidMesh.castShadow = lidMesh.receiveShadow = true;
    lid.add(lidMesh);
    const marks = canvasTexture(256, (ctx, s) => {
        ctx.clearRect(0, 0, s, s);
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(s * 0.17, s * 0.17, s * 0.055, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(214,214,218,0.62)'; ctx.textAlign = 'center';
        ctx.font = `600 ${s * 0.13}px sans-serif`; ctx.fillText('BT-26', s * 0.5, s * 0.52);
        ctx.font = `500 ${s * 0.085}px sans-serif`; ctx.fillText('Q44  2639', s * 0.5, s * 0.68);
    });
    const marksGeo = new THREE.PlaneGeometry(C - 0.02, C - 0.02);
    marksGeo.rotateX(-Math.PI / 2);
    const marksMesh = new THREE.Mesh(marksGeo, new THREE.MeshStandardMaterial({ map: marks.tex, transparent: true, roughness: 0.7, depthWrite: false }));
    marksMesh.position.y = HL + 0.0004;
    lid.add(marksMesh);

    function open(p) {                     // p: 0 closed, 1 lifted off and set back
        const rise = smoothstep(0, 0.55, p), back = smoothstep(0.2, 1, p);
        lid.position.set(0, PART + 0.12 * rise, -0.29 * back);
        lid.rotation.x = 0.38 * back;
    }

    // lift it off, hold, put it back
    const UP = 1000, HOLD = 1700, DOWN = 1000;
    let t0 = null, last = -1;
    return {
        scene, camera,
        play(now) { if (!still && (t0 == null || now - t0 > UP + HOLD + DOWN)) t0 = now; },
        set(now) {
            let p = 0;
            if (!still && t0 != null) {
                const e = Math.max(0, now - t0);
                p = e < UP ? easeInOut(e / UP) : e < UP + HOLD ? 1 : easeInOut(clamp(1 - (e - UP - HOLD) / DOWN, 0, 1));
            }
            if (p !== last) { open(p); last = p; }
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

    const env = studio(renderer);
    const glyphs = slots.map(slot => BUILD[slot.kind]({ still, env }));
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

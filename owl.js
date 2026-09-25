// The page folds itself into an owl: a three.js rendering of the fold model in
// owl-model.js (the crease sequence, and why a hinge rig can fold it honestly, are
// described there).

import * as THREE from 'three';
import {
    H, stages, buildModel, movedIn, isWing, CREAM, TERRACOTTA, INK, EYES, EYE_R, BEAK, BEAK_INK,
    WING_AXIS_A, WING_AXIS_D, WING_EDGE_FADE, WING_KAPPA, bodyEdgeX,
} from './owl-model.js';
import { paperMaterial, addLamp, deskShadowMaterial, clamp, easeInOut, smoothstep, darkScheme, makeRenderer } from './paper.js';

const EPS = 0.004;               // paper thickness, in sheet units (the square has side 1)

// ---------- paper texture: cream, with the eyes and beak inked on at the end ----------

// The texture covers only the band the ink lands on; clamped sampling carries its
// cream edge over the rest of the sheet. While the ink goes on it is redrawn and
// uploaded every frame, so it is kept small: 512 px wide, about an eighth of a
// whole-sheet texture's bytes, and sharper, since those pixels cover far less paper.
function makePaperTexture() {
    const pad = 0.03 * H;
    const xs = [...EYES.map(e => e[0] - EYE_R), ...EYES.map(e => e[0] + EYE_R), ...BEAK.map(b => b[0])];
    const ys = [...EYES.map(e => e[1] - EYE_R), ...EYES.map(e => e[1] + EYE_R), ...BEAK.map(b => b[1])];
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad;
    const y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    const W = 512, perUnit = W / (x1 - x0), Hpx = Math.ceil((y1 - y0) * perUnit);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = Hpx;
    const ctx = canvas.getContext('2d');
    const hex = c => '#' + c.toString(16).padStart(6, '0');
    const toPx = ([x, y]) => [(x - x0) * perUnit, (y1 - y) * perUnit];
    const r = EYE_R * perUnit;
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
    // sheet uv (0..1 over the whole square) -> this band
    const u0 = x0 / (2 * H) + 0.5, v0 = y0 / (2 * H) + 0.5;
    tex.repeat.set(2 * H / (x1 - x0), 2 * H / (y1 - y0));
    tex.offset.set(-u0 * tex.repeat.x, -v0 * tex.repeat.y);

    // u in 0..1: left eye, right eye, then the beak
    function draw(u) {
        ctx.fillStyle = hex(CREAM);
        ctx.fillRect(0, 0, W, Hpx);
        eye(EYES[0], seg(u, 0, 0.36));
        eye(EYES[1], seg(u, 0.36, 0.7));
        beak(seg(u, 0.72, 1));
        tex.needsUpdate = true;
    }
    draw(0);
    return { tex, draw };
}

// ---------- scene ----------

// opts:
//   still     reduced motion: the finished owl, lit, with no animation at all
//   settled   () => boolean, asked once the owl is ready to draw: start already
//             folded (the flat fallback owl is showing by then)
//   fixedT    debug: freeze the fold at stage t (?fold=)
//   curlScale debug: scale the wing curl (?curl=)
export async function mountOwl(stage, opts = {}) {
    const { polys, lines, edges } = buildModel();
    const nStages = stages.length;

    const renderer = makeRenderer();
    if (!renderer) return null;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoft ignores shadow.radius; PCF blurs by it
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', 'An origami owl, folded from a square of paper');
    stage.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    const key = addLamp(scene, { shadow: true });
    key.shadow.radius = 5;

    // a desk behind the sheet that only shows the sheet's shadow
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), deskShadowMaterial());
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

    // normals are computed per frame: flat on flat paper, smooth on the curled wings
    const paper = makePaperTexture();
    const mat = paperMaterial({ map: paper.tex, back: TERRACOTTA });

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
    // so the curl shades as one smooth surface. Real creases are never smoothed. The
    // curl moves points by where they sit in the finished owl, so corners that meet
    // there meet in every frame: the groups are found once, from the final flat coords.
    const wingGroups = [];
    {
        const groups = new Map();
        let v = 0;
        for (const p of polys) {
            const n = p.v.length, h = p.hub, fin = p.fAt[nStages];
            for (let k = 1; k < n - 1; k++) for (const c of [h, (h + k) % n, (h + k + 1) % n]) {
                if (isWing(p)) {
                    const key = p.layer + ':' + fin[c][0].toFixed(5) + ',' + fin[c][1].toFixed(5);
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key).push(v);
                }
                v++;
            }
        }
        for (const g of groups.values()) if (g.length > 1) wingGroups.push(Int32Array.from(g));
    }
    function smoothWingNormals() {
        const nor = geom.attributes.normal.array;
        for (const g of wingGroups) {
            let x = 0, y = 0, z = 0;
            for (const v of g) { x += nor[v * 3]; y += nor[v * 3 + 1]; z += nor[v * 3 + 2]; }
            const len = Math.hypot(x, y, z) || 1;
            for (const v of g) { nor[v * 3] = x / len; nor[v * 3 + 1] = y / len; nor[v * 3 + 2] = z / len; }
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

    // ----- timeline -----
    const START_DELAY = 0.45;
    const durs = stages.map(st => st.dur || 0.5);
    const starts = durs.reduce((acc, d, k) => { acc.push(k ? acc[k - 1] + durs[k - 1] : 0); return acc; }, []);
    const total = starts[nStages - 1] + durs[nStages - 1];
    const fixedT = opts.fixedT;
    const still = !!opts.still;
    let introStart = performance.now();
    let mouse = [0, 0], tilt = [0, 0];
    let visible = true;

    function introT(now) {
        const sec = clamp((now - introStart) / 1000 - START_DELAY, 0, total);
        let k = 0;
        while (k < nStages - 1 && sec >= starts[k + 1]) k++;
        return k + easeInOut(clamp((sec - starts[k]) / durs[k], 0, 1));
    }
    // scrolling past the hero unfolds the owl, and scrolling back folds it again
    function scrollT() {
        const p = clamp(window.scrollY / (window.innerHeight * 0.55), 0, 1);
        return nStages * (1 - p);
    }

    let lastT = -1, lastInk = -1;
    let turn = 0;                 // current turn-over angle, eased
    function draw(now) {
        let t, turnTarget, ink;
        if (fixedT != null) { t = fixedT; turnTarget = turnAngle(t); ink = fixedT >= nStages ? 1 : 0; }
        else if (still) { t = nStages; turnTarget = 0; ink = 1; }
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
        }
        if (t !== lastT) { writePositions(t); lastT = t; }
        if (ink !== lastInk) { paper.draw(ink); lastInk = ink; }

        // ease toward the target along the shortest way round (2 pi and 0 are the same face)
        const TAU = Math.PI * 2;
        let diff = ((turnTarget - turn) % TAU + TAU * 1.5) % TAU - Math.PI;
        turn = still ? turnTarget : turn + diff * 0.25;

        // idle motion: a slow sway, and a lean toward the pointer
        const sec = still ? 0 : now / 1000;
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

    // ----- sizing and scheduling -----
    let pending = false;
    const invalidate = () => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(now => { pending = false; draw(now); });
    };
    function resize() {
        const w = stage.clientWidth, h = stage.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        invalidate();
    }
    // compile before the first frame, off the main thread where the driver allows
    writePositions(0);
    await renderer.compileAsync(scene, camera);
    // a settled owl starts as if its intro had finished long ago
    const settled = still || !!opts.settled?.();
    introStart = performance.now() - (settled ? (START_DELAY + total + 2) * 1000 : 0);
    resize();
    new ResizeObserver(resize).observe(stage);
    darkScheme.addEventListener('change', invalidate);

    if (!still) {
        window.addEventListener('pointermove', e => {
            mouse = [e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5];
        }, { passive: true });
        if ('IntersectionObserver' in window) {
            new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0 }).observe(stage);
        }
        const loop = now => {
            requestAnimationFrame(loop);
            if (visible) draw(now);
        };
        requestAnimationFrame(loop);
    }

    return {
        settled,
        // fold it again from a flat sheet (the stage's button)
        refold() {
            if (!still) introStart = performance.now();
        },
    };
}

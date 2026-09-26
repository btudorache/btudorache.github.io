// The page folds itself into an owl: a three.js rendering of the fold model in
// owl-model.js (Román Díaz's owl; its crease sequence, and how each step was checked,
// are described there). fold.js works out where every piece of paper is at each
// moment; this file only draws it.

import * as THREE from 'three';
import { stages, buildModel, sharpCrease, YELLOW, CHARCOAL, CHARCOAL_ON_DARK } from './owl-model.js';
import { pose } from './fold.js';
import { paperMaterial, addLamp, deskShadowMaterial, clamp, easeInOut, darkScheme, makeRenderer } from './paper.js';

const EPS = 0.0018;              // paper thickness: one layer, in sheet units (the square has side 1)
const PACE = 0.75;               // the model's stage durations, scaled for the page

// opts:
//   still     reduced motion: the finished owl, lit, with no animation at all
//   settled   () => boolean, asked once the owl is ready to draw: start already
//             folded (the flat fallback owl is showing by then)
//   fixedT    debug: freeze the fold at stage t (?fold=)
export async function mountOwl(stage, opts = {}) {
    const model = buildModel();
    const { polys, edges } = model;
    const nStages = stages.length;
    const shaping = stages.findIndex(st => st.shape);   // the last stage bends rather than folds

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
    desk.position.z = -0.5;
    desk.receiveShadow = true;
    scene.add(desk);

    const triCount = polys.reduce((n, p) => n + p.v.length - 2, 0);
    const positions = new Float32Array(triCount * 9);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = paperMaterial({ front: YELLOW, back: CHARCOAL });
    const setBack = () => mat.userData.back.value.set(darkScheme.matches ? CHARCOAL_ON_DARK : CHARCOAL);
    setBack();
    // Push the faces back a hair so their own edge lines win the depth test. Mostly by
    // a constant amount: the slope-scaled part grows on steep facets (the tail's pleats)
    // until it exceeds a layer's thickness, and the creases of the layer behind show through.
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 0.25;
    mat.polygonOffsetUnits = 2;

    const sheet = new THREE.Mesh(geom, mat);
    sheet.castShadow = true;   // onto the desk only: self-shadowing paper-thin layers gives acne
    const group = new THREE.Group();
    group.add(sheet);

    const edgePositions = new Float32Array(edges.length * 6);
    const edgeGeom = new THREE.BufferGeometry();
    edgeGeom.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
    const edgeLines = new THREE.LineSegments(edgeGeom, new THREE.LineBasicMaterial({
        color: 0x1f1c19, transparent: true, opacity: 0.32,
    }));
    group.add(edgeLines);
    scene.add(group);

    // While the owl takes its final shape, shade the paper as one surface: average the
    // normals of corners that meet on the same layer, wherever the paper was only cut to
    // bend it. The tail's pleats and the base's crease stay sharp (owl-model.js).
    const smoothGroups = [];
    {
        const groups = new Map();
        let v = 0;
        for (const p of polys) {
            const n = p.v.length, h = p.hub, fin = p.fAt[shaping];
            for (let k = 1; k < n - 1; k++) for (const c of [h, (h + k) % n, (h + k + 1) % n]) {
                const [x, y] = fin[c];
                if (!sharpCrease(x, y)) {
                    const key = p.layer + ':' + x.toFixed(5) + ',' + y.toFixed(5);
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key).push(v);
                }
                v++;
            }
        }
        for (const g of groups.values()) if (g.length > 1) smoothGroups.push(Int32Array.from(g));
    }
    function smoothNormals() {
        const nor = geom.attributes.normal.array;
        for (const g of smoothGroups) {
            let x = 0, y = 0, z = 0;
            for (const v of g) { x += nor[v * 3]; y += nor[v * 3 + 1]; z += nor[v * 3 + 2]; }
            const len = Math.hypot(x, y, z) || 1;
            for (const v of g) { nor[v * 3] = x / len; nor[v * 3 + 1] = y / len; nor[v * 3 + 2] = z / len; }
        }
        geom.attributes.normal.needsUpdate = true;
    }

    function writePositions(t) {
        const out = pose(model, t, EPS);
        let i = 0;
        for (let pi = 0; pi < polys.length; pi++) {
            const c = out[pi], n = c.length, h = polys[pi].hub;
            for (let k = 1; k < n - 1; k++) for (const q of [c[h], c[(h + k) % n], c[(h + k + 1) % n]]) {
                positions[i++] = q[0]; positions[i++] = q[1]; positions[i++] = q[2];
            }
        }
        geom.attributes.position.needsUpdate = true;
        geom.computeVertexNormals();
        geom.computeBoundingSphere();
        if (t > shaping) smoothNormals();

        const K = clamp(Math.floor(t), 0, nStages - 1), prog = t - K;
        let e = 0;
        for (const ed of edges) {
            if (!(ed.since < K || (ed.since === K && prog > 0))) continue;
            const a = out[ed.pi][ed.i], b = out[ed.pi][ed.j];
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
    const durs = stages.map(st => (st.dur || 0.5) * PACE);
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
    let lastT = -1;
    let turn = 0;                 // current turn-over angle, eased
    let framed = null;            // the camera's distance and aim, eased (see draw)
    const dir = new THREE.Vector3();
    function draw(now) {
        let t, turnTarget;
        if (fixedT != null) { t = fixedT; turnTarget = turnAngle(t); }
        else if (still) { t = nStages; turnTarget = 0; }
        else {
            // Only the clock drives the fold, not the page's scroll: a fold of this many
            // steps, scrubbed by a few wheel ticks, jumps between states and turn-overs
            // faster than anyone can follow. The owl is folded partly from the back of
            // the paper, so the intro turns the sheet over and back.
            t = introT(now);
            turnTarget = turnAngle(t);
        }
        if (t !== lastT) { writePositions(t); lastT = t; }

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

        // Watch the folding from over the shoulder, then settle in front of the owl,
        // always just far enough back to keep all the paper in view: a square sheet
        // needs more room than the owl it becomes. The framing follows the paper's
        // bounding sphere, eased so it never jumps.
        const done = easeInOut(clamp(t / nStages, 0, 1));
        group.position.y = Math.sin(sec * 0.8) * 0.012;
        const sphere = geom.boundingSphere;
        const centre = group.localToWorld(sphere.center.clone());
        const half = THREE.MathUtils.degToRad(camera.fov / 2);
        const narrow = Math.min(half, Math.atan(Math.tan(half) * camera.aspect));
        const want = { dist: 1.12 * sphere.radius / Math.sin(narrow), y: centre.y, x: centre.x };
        const k = still || fixedT != null || !framed ? 1 : 0.08;
        framed = framed || {};
        for (const key of ['dist', 'y', 'x']) framed[key] = framed[key] == null ? want[key] : framed[key] + (want[key] - framed[key]) * k;
        dir.set(-1.1 * (1 - done), 1.2 - 1.1 * done, 2.7 - 0.9 * done).normalize();
        camera.position.set(framed.x, framed.y, 0).addScaledVector(dir, framed.dist);
        camera.lookAt(framed.x, framed.y, 0);
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
    darkScheme.addEventListener('change', () => { setBack(); invalidate(); });

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

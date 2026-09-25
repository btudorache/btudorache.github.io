// Scraps of paper drifting behind the page: squares with one crease each, folded a
// little and slowly breathing open and shut as they turn over in the air. They keep
// to the margins when the window is wide enough to have margins, fade into the
// page with distance, and sit at real depths, so scrolling moves near scraps more
// than far ones. One instanced draw call; the crease is bent in the vertex shader.

import * as THREE from 'three';
import { COLORS, paperMaterial, addLamp, darkScheme, makeRenderer } from './paper.js';

const FOV = 35;
const TAN = Math.tan(FOV / 2 * Math.PI / 180);
const NEAR_Z = 13, FAR_Z = 32;         // scraps live between these depths
const REF_Z = 20;                      // depth that scrolls at PARALLAX times the page
const PARALLAX = 0.3;
const COLUMN = 880 / 2 + 36;           // half-width of the text column in CSS px (.page)
const MAX = 16;
const PAGE = { light: 0xfaf6ee, dark: 0x1a1713 };   // --paper, for the fog to fade into
const BACKS = [COLORS.terracotta, COLORS.sage, COLORS.blue, COLORS.gold];

export async function mountDrift(canvas, { still = false } = {}) {
    const renderer = makeRenderer({ canvas });
    if (!renderer) return null;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0, NEAR_Z + 2, FAR_Z + 8);
    const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 80);
    addLamp(scene);

    // One square creased along its diagonal (the x axis): two triangles that turn
    // about the crease by aFold in opposite senses, so the scrap opens into a V.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
        -1, 0, 0, 1, 0, 0, 0, 1, 0,      // upper half
        1, 0, 0, -1, 0, 0, 0, -1, 0,     // lower half
    ], 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    geo.setAttribute('aSide', new THREE.Float32BufferAttribute([1, 1, 1, -1, -1, -1], 1));
    const fold = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    fold.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFold', fold);

    const mat = paperMaterial({ backFromInstance: true });
    const paperPatch = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
        paperPatch(sh, r);
        sh.vertexShader = 'attribute float aSide;\nattribute float aFold;\n' + sh.vertexShader
            .replace('#include <beginnormal_vertex>',
                'vec3 objectNormal = vec3(0.0, -aSide * sin(aFold), cos(aFold));')
            .replace('#include <begin_vertex>',
                'vec3 transformed = vec3(position.x, position.y * cos(aFold), abs(position.y) * sin(aFold));');
    };
    mat.customProgramCacheKey = () => 'paper-scrap';

    const mesh = new THREE.InstancedMesh(geo, mat, MAX);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;   // instances roam far outside the base square's bounds
    scene.add(mesh);

    // ----- the scraps -----
    const rand = (a, b) => a + Math.random() * (b - a);
    let vw = 1, vh = 1, camY = 0;
    const halfH = z => -z * TAN;
    const halfW = z => halfH(z) * vw / vh;

    // x for a scrap at depth z: in a margin if the margins can hold it, else anywhere
    function placeX(s) {
        const hw = halfW(s.z), col = COLUMN / (vw / 2) * hw;
        const side = Math.random() < 0.5 ? -1 : 1;
        s.x = hw - col > s.size * 2.2 ? side * rand(col + s.size, hw + s.size * 0.3) : rand(-hw, hw);
    }
    function spawn(s, where) {
        s.z = -rand(NEAR_Z, FAR_Z);
        s.size = rand(0.2, 0.42);
        placeX(s);
        const hh = halfH(s.z) + s.size;
        s.y = camY + (where === 'below' ? -hh : where === 'above' ? hh : rand(-hh, hh));
        s.vx = rand(-0.03, 0.03);
        s.vy = rand(0.05, 0.12);
        s.q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6.3), rand(0, 6.3), rand(0, 6.3)));
        s.axis = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
        s.spin = rand(0.08, 0.22) * (Math.random() < 0.5 ? -1 : 1);
        s.fold0 = rand(0.35, 0.95);
        s.foldAmp = rand(0.12, 0.32);
        s.foldW = Math.PI * 2 / rand(9, 16);
        s.phase = rand(0, 6.3);
        return s;
    }
    const scraps = Array.from({ length: MAX }, (_, i) => {
        const s = spawn({}, 'anywhere');
        mesh.setColorAt(i, new THREE.Color(BACKS[i % BACKS.length]));
        return s;
    });

    const m = new THREE.Matrix4(), dq = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    function step(t, dt) {
        for (let i = 0; i < mesh.count; i++) {
            const s = scraps[i];
            s.x += s.vx * dt;
            s.y += s.vy * dt;
            s.q.multiply(dq.setFromAxisAngle(s.axis, s.spin * dt));
            // off the top or bottom of the view (drifting, or scrolled past): come back
            // in from the other side, somewhere new
            const hh = halfH(s.z) + s.size;
            if (s.y - camY > hh) spawn(s, 'below');
            else if (s.y - camY < -hh) spawn(s, 'above');
            m.compose(v.set(s.x, s.y, s.z), s.q, sc.setScalar(s.size));
            mesh.setMatrixAt(i, m);
            fold.array[i] = s.fold0 + s.foldAmp * Math.sin(t * s.foldW + s.phase);
        }
        mesh.instanceMatrix.needsUpdate = true;
        fold.needsUpdate = true;
    }

    function applyTheme() {
        scene.fog.color.set(darkScheme.matches ? PAGE.dark : PAGE.light);
    }
    applyTheme();

    function resize() {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        vw = w; vh = h;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        mesh.count = w >= 1200 ? MAX : w >= 760 ? 9 : 5;
        for (const s of scraps) placeX(s);
    }

    // camera height for the current scroll: world units per CSS px at REF_Z
    const scrollCamY = () => still ? 0 : -window.scrollY * (2 * REF_Z * TAN / vh) * PARALLAX;

    let last = performance.now(), lastScroll = -1e9, frame = 0;
    function draw(now) {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        camY = scrollCamY();
        camera.position.set(0, camY, 0);
        step(now / 1000, still ? 0 : dt);
        renderer.render(scene, camera);
    }

    resize();
    await renderer.compileAsync(scene, camera);   // off the main thread where the driver allows
    new ResizeObserver(() => { resize(); if (still) draw(performance.now()); }).observe(canvas);
    darkScheme.addEventListener('change', () => { applyTheme(); if (still) draw(performance.now()); });

    if (still) {
        draw(performance.now());
    } else {
        window.addEventListener('scroll', () => { lastScroll = performance.now(); }, { passive: true });
        const loop = now => {
            requestAnimationFrame(loop);
            // the drift is slow enough for 30 fps; while the page scrolls, the
            // parallax needs every frame to keep pace with the content
            if (now - lastScroll > 250 && (frame++ & 1)) return;
            draw(now);
        };
        requestAnimationFrame(loop);
    }
    return {};
}

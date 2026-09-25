// Shared by every three.js scene on the page: one kind of paper, one lamp, so the
// owl, the drifting scraps and the interest glyphs read as the same material.

import * as THREE from 'three';

export const COLORS = {
    cream: 0xf8f1e4,
    terracotta: 0xb85a36,
    ink: 0x2b2721,
    sage: 0x7d8c6a,
    blue: 0x5d7f9d,
    gold: 0xc9a24b,
};

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const easeInOut = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
export const smoothstep = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
export const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');

// Paper has two sides. The front shows `front` (or `map`); the back shows `back`,
// or, with `backFromInstance`, each instance's colour (InstancedMesh.setColorAt),
// so one draw call can hold scraps of differently coloured paper.
export function paperMaterial({ front = COLORS.cream, back = COLORS.terracotta, map = null, backFromInstance = false } = {}) {
    const mat = new THREE.MeshStandardMaterial({
        color: map ? 0xffffff : front, map, roughness: 0.94, metalness: 0,
        side: THREE.DoubleSide,
    });
    const uBack = { value: new THREE.Color(back) };
    mat.onBeforeCompile = sh => {
        sh.uniforms.uBack = uBack;
        sh.fragmentShader = 'uniform vec3 uBack;\n' + sh.fragmentShader.replace(
            '#include <color_fragment>',
            backFromInstance
                ? 'vec3 paperFront = diffuseColor.rgb;\n#include <color_fragment>\n\tdiffuseColor.rgb = gl_FrontFacing ? paperFront : vColor;'
                : '#include <color_fragment>\n\tif (!gl_FrontFacing) diffuseColor.rgb = uBack;'
        );
    };
    // the two variants patch the shader differently, so they must not share a program
    mat.customProgramCacheKey = () => backFromInstance ? 'paper-instanced' : 'paper';
    mat.userData.back = uBack;
    return mat;
}

// The lamp: warm sky, a key light from the upper left, a soft fill from the right.
export function addLamp(scene, { shadow = false, mapSize = 1024, extent = 1.2 } = {}) {
    scene.add(new THREE.HemisphereLight(0xfff8ec, 0xa88266, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(-1.2, 2.0, 2.4);
    if (shadow) {
        key.castShadow = true;
        key.shadow.mapSize.set(mapSize, mapSize);
        key.shadow.camera.left = key.shadow.camera.bottom = -extent;
        key.shadow.camera.right = key.shadow.camera.top = extent;
        key.shadow.camera.near = 0.5;
        key.shadow.camera.far = 8;
        key.shadow.bias = -0.0004;
        key.shadow.normalBias = 0.01;
    }
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffe9d6, 0.7);
    fill.position.set(1.5, -0.5, 1.5);
    scene.add(fill);
    return key;
}

// A shadow on the desk: warm, not grey. Paper on a cream desk under a warm lamp
// throws a brown shadow; on the dark theme's desk it is simply darker.
export function deskShadowMaterial() {
    const mat = new THREE.ShadowMaterial();
    const apply = () => {
        mat.color.set(darkScheme.matches ? 0x000000 : 0x5a3320);
        mat.opacity = darkScheme.matches ? 0.42 : 0.2;
    };
    apply();
    darkScheme.addEventListener('change', apply);
    return mat;
}

export function makeRenderer(opts = {}) {
    try {
        const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power', ...opts });
        return r;
    } catch (e) {
        return null;
    }
}

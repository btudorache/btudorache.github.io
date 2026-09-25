// Boots the three.js pieces of the page. Each one falls back on its own: the flat
// SVG owl, no drifting paper, the SVG glyphs.
//
// Debug parameters: ?fold=<t> freezes the owl at stage t (0..11); ?curl=<k> scales
// the wing curl.

const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);

// Nothing here runs before the page's first paint: the text is what a visitor
// came for, and three.js takes a few hundred milliseconds of main thread on a
// phone. (The modules are already downloading: see the modulepreloads.)
const afterFirstPaint = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

// ----- the owl: first, it is the one thing in view -----
const hero = document.querySelector('.hero');
const stage = document.querySelector('.owl-stage');
(async () => {
    await afterFirstPaint();
    const { mountOwl } = await import('./owl.js');
    const owl = await mountOwl(stage, {
        still,
        // the flat owl shows by itself after 2.5 s (style.css); if the 3D one is
        // only ready after that, it takes over already folded rather than unfolding
        settled: () => performance.now() > 2400,
        fixedT: params.has('fold') ? parseFloat(params.get('fold')) : undefined,
        curlScale: params.has('curl') ? parseFloat(params.get('curl')) : undefined,
    });
    if (!owl) throw new Error('no WebGL');
    hero.classList.add('owl-3d');
    if (owl.settled && !still) hero.classList.add('owl-late');
    if (!still) {
        const again = document.createElement('button');
        again.type = 'button';
        again.className = 'owl-again';
        again.title = 'Fold it again';
        again.setAttribute('aria-label', 'Fold the owl again');
        again.addEventListener('click', () => owl.refold());
        stage.append(again);
    }
})().catch(() => hero.classList.add('owl-flat'));

// ----- the drifting paper: once the page is idle, so its shaders don't cost the
// owl any frames while it folds -----
const idle = window.requestIdleCallback || (f => setTimeout(f, 1200));
idle(async () => {
    const canvas = document.getElementById('paper-drift');
    try {
        const { mountDrift } = await import('./drift.js');
        if (await mountDrift(canvas, { still })) canvas.classList.add('ready');
        else canvas.remove();
    } catch (e) {
        canvas.remove();
    }
}, { timeout: 3000 });

// ----- the interest glyphs: when their section comes near -----
const interests = document.getElementById('interests');
new IntersectionObserver(async (entries, io) => {
    if (!entries.some(e => e.isIntersecting)) return;
    io.disconnect();
    try {
        const { mountGlyphs } = await import('./glyphs.js');
        const slots = [...interests.querySelectorAll('.glyph')].map(el => ({
            el, kind: el.dataset.glyph, card: el.closest('li'),
        }));
        if (await mountGlyphs(slots, { still })) interests.classList.add('has-glyphs');
    } catch (e) { /* the SVG glyphs stay */ }
}, { rootMargin: '600px 0px' }).observe(interests);

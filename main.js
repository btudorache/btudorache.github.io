// Boots the folding owl in the hero, with the SVG owl as the fallback.
const root = document.documentElement;
const reveal = () => root.classList.remove('folding');
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    reveal();
} else {
    const hero = document.querySelector('.hero');
    try {
        const { mountOwl } = await import('./owl.js?v=4');
        const stage = document.querySelector('.owl-stage');
        const params = new URLSearchParams(location.search);
        const fixedT = params.has('fold') ? parseFloat(params.get('fold')) : undefined;
        hero.classList.add('has-3d');
        const curlScale = params.has('curl') ? parseFloat(params.get('curl')) : undefined;
        const owl = mountOwl(stage, { onReveal: reveal, fixedT, curlScale });
        if (!owl) { hero.classList.remove('has-3d'); reveal(); }
        if (fixedT != null) reveal();
    } catch (e) {
        hero.classList.remove('has-3d');
        reveal();
    }
}

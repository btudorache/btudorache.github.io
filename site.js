// Fade sections in as they scroll into view. Content is only hidden for this when
// scripts run (the .js class, set in the page head), so without them it is simply there.
(function () {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
        els.forEach(el => el.classList.add('visible'));
        return;
    }
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12 });
    els.forEach(el => observer.observe(el));
})();

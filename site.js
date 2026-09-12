// Drifting origami paper shapes in the background
(function () {
    const canvas = document.getElementById('paper-canvas');
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const colors = ['#c2643f', '#7d8c6a', '#5d7f9d', '#c9a24b'];
    let shapes = [];
    let width, height;

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }

    function makeShape() {
        return {
            x: Math.random() * width,
            y: Math.random() * height,
            size: 12 + Math.random() * 26,
            color: colors[Math.floor(Math.random() * colors.length)],
            angle: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 0.004,
            vx: (Math.random() - 0.5) * 0.15,
            vy: -0.06 - Math.random() * 0.12,
            opacity: 0.05 + Math.random() * 0.07
        };
    }

    function drawShape(s) {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle);
        ctx.globalAlpha = s.opacity;
        ctx.fillStyle = s.color;
        // two triangles sharing an edge, like a fold
        ctx.beginPath();
        ctx.moveTo(-s.size, s.size * 0.6);
        ctx.lineTo(0, -s.size);
        ctx.lineTo(0, s.size * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = s.opacity * 0.6;
        ctx.beginPath();
        ctx.moveTo(s.size, s.size * 0.6);
        ctx.lineTo(0, -s.size);
        ctx.lineTo(0, s.size * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function tick() {
        ctx.clearRect(0, 0, width, height);
        for (const s of shapes) {
            s.x += s.vx;
            s.y += s.vy;
            s.angle += s.spin;
            if (s.y < -60) { s.y = height + 60; s.x = Math.random() * width; }
            if (s.x < -60) s.x = width + 60;
            if (s.x > width + 60) s.x = -60;
            drawShape(s);
        }
        if (!reduceMotion) requestAnimationFrame(tick);
    }

    resize();
    const count = Math.min(26, Math.floor(width / 60));
    shapes = Array.from({ length: count }, makeShape);
    window.addEventListener('resize', resize);
    tick();
})();

// Fade sections in as they scroll into view
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

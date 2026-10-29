/* ============================================================
   particle-bg.js —— 纯白底 · 深灰粒子连线 背景
   ============================================================ */
(function() {
    // 防止重复加载
    if (window.__DIJIANG_PARTICLE_BG_LOADED__) return;
    window.__DIJIANG_PARTICLE_BG_LOADED__ = true;

    // 1. 动态创建 Canvas 并插入到 body 的最前面
    const canvas = document.createElement('canvas');
    canvas.id = 'particleCanvas';
    Object.assign(canvas.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        zIndex: '-1',
        pointerEvents: 'none', // 穿透点击
    });
    document.body.insertBefore(canvas, document.body.firstChild);

    const ctx = canvas.getContext('2d');
    let width, height;
    let particles = [];
    let mouse = { x: null, y: null, radius: 150 }; 

    const config = {
        maxDistance: 120,
        speed: 0.4,
        mouseRepelRadius: 120,
        particleColor: '68, 68, 68',
        lineColor: '85, 85, 85'
    };

    function resizeCanvas() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        initParticles();
    }

    function initParticles() {
        particles = [];
        const count = Math.floor((width * height) / 12000); 
        const actualCount = Math.max(40, Math.min(count, 150)); 

        for (let i = 0; i < actualCount; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * config.speed,
                vy: (Math.random() - 0.5) * config.speed,
                radius: Math.random() * 1.5 + 0.8
            });
        }
    }

    window.addEventListener('mousemove', (e) => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
    });

    window.addEventListener('mouseleave', () => {
        mouse.x = null;
        mouse.y = null;
    });

    window.addEventListener('resize', resizeCanvas);

    function animate() {
        ctx.clearRect(0, 0, width, height);

        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;

            if (p.x < 0 || p.x > width) p.vx *= -1;
            if (p.y < 0 || p.y > height) p.vy *= -1;

            if (mouse.x !== null && mouse.y !== null) {
                let dx = p.x - mouse.x;
                let dy = p.y - mouse.y;
                let distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < config.mouseRepelRadius) {
                    let force = (config.mouseRepelRadius - distance) / config.mouseRepelRadius;
                    p.x += (dx / distance) * force * 3;
                    p.y += (dy / distance) * force * 3;
                }
            }

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${config.particleColor}, 0.9)`; 
            ctx.fill();
        });

        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                let p1 = particles[i];
                let p2 = particles[j];
                let dx = p1.x - p2.x;
                let dy = p1.y - p2.y;
                let distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < config.maxDistance) {
                    let alpha = (1 - (distance / config.maxDistance)) * 0.5;
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(${config.lineColor}, ${alpha})`; 
                    ctx.lineWidth = 0.8;
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                }
            }
        }

        if (mouse.x !== null && mouse.y !== null) {
            particles.forEach(p => {
                let dx = p.x - mouse.x;
                let dy = p.y - mouse.y;
                let distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < mouse.radius) {
                    let alpha = (1 - (distance / mouse.radius)) * 0.6;
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(${config.particleColor}, ${alpha})`;
                    ctx.lineWidth = 0.8;
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(mouse.x, mouse.y);
                    ctx.stroke();
                }
            });
        }

        requestAnimationFrame(animate);
    }

    resizeCanvas();
    animate();
})();
import { useEffect, useRef } from 'react';
import { useTheme } from '../theme-context';

interface Particle {
  x: number;
  y: number;
  size: number;
  speedX: number;
  speedY: number;
  opacity: number;
  fadeDir: number;
  amplitude: number;
  frequency: number;
  time: number;
}

export function Particles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const particles: Particle[] = [];
    const count = 60;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 2.5 + 0.5,
        speedX: (Math.random() - 0.5) * 0.4,
        speedY: (Math.random() - 0.5) * 0.2 - 0.05,
        opacity: Math.random() * 0.4,
        fadeDir: Math.random() > 0.5 ? 1 : -1,
        amplitude: Math.random() * 1.5,
        frequency: Math.random() * 0.02,
        time: Math.random() * 100,
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.time += 0.01;
        p.x += p.speedX + Math.sin(p.time * 2) * 0.1;
        p.y += p.speedY + Math.cos(p.time * 3) * 0.05;
        p.opacity += p.fadeDir * 0.0015;

        if (p.opacity > 0.5) p.fadeDir = -1;
        if (p.opacity < 0.01) p.fadeDir = 1;

        if (p.x < -20) p.x = canvas.width + 20;
        if (p.x > canvas.width + 20) p.x = -20;
        if (p.y < -20) p.y = canvas.height + 20;
        if (p.y > canvas.height + 20) p.y = -20;

        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 4);

        const getColors = () => {
          const c1 = theme.particleColors[0].match(/\d+/g)?.slice(0, 3).join(',') || '255,255,255';
          const c2 = theme.particleColors[1].match(/\d+/g)?.slice(0, 3).join(',') || '255,255,255';
          return [c1, c2];
        };

        const [base1, base2] = getColors();

        gradient.addColorStop(0, `rgba(${base1}, ${p.opacity})`);
        gradient.addColorStop(0.4, `rgba(${base2}, ${p.opacity * 0.4})`);
        gradient.addColorStop(1, `rgba(${base2}, 0)`);

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 4, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity * 1.5})`;
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [theme]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-[2] pointer-events-none"
    />
  );
}

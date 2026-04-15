import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, useInView } from 'framer-motion';
import {
  Container,
  Wrench,
  Store,
  Activity,
  ArrowRight,
  Sparkles,
  Rocket,
  MessageSquare,
  Zap,
  Github,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';

/* ---------- Particle canvas ---------- */
function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const particles: Array<{
      x: number; y: number; vx: number; vy: number; size: number; alpha: number;
    }> = [];

    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * canvas.width, y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
        size: Math.random() * 2 + 0.5, alpha: Math.random() * 0.35 + 0.1,
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(99,102,241,${p.alpha})`;
        ctx.fill();
      }
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(99,102,241,${0.05 * (1 - dist / 100)})`;
            ctx.stroke();
          }
        }
      }
      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />;
}

/* ---------- Animated counter ---------- */
function Counter({ end, suffix = '', prefix = '' }: { end: number; suffix?: string; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [val, setVal] = useState(0);

  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const duration = 1800;
    const t0 = performance.now();
    const tick = (now: number) => {
      const elapsed = now - t0;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      start = Math.round(eased * end);
      setVal(start);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [inView, end]);

  return <span ref={ref}>{prefix}{val.toLocaleString()}{suffix}</span>;
}

/* ---------- Section wrapper with scroll animation ---------- */
function Section({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  return (
    <motion.section
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

/* ---------- Glass card ---------- */
const glassCard =
  'relative rounded-2xl border border-[var(--glass-border)] bg-[var(--bg-secondary)]/40 backdrop-blur-xl shadow-elevation-2 ' +
  'transition-all duration-300 hover:border-[var(--accent)]/20 hover:shadow-elevation-3 hover:shadow-[var(--accent)]/5 hover:-translate-y-0.5';

/* ---------- Main ---------- */
export default function Landing() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthStore();

  const features = [
    { icon: Container, title: t('landing.features.sessions.title'), desc: t('landing.features.sessions.desc'), gradient: 'from-blue-500 to-cyan-400' },
    { icon: Wrench, title: t('landing.features.tools.title'), desc: t('landing.features.tools.desc'), gradient: 'from-purple-500 to-pink-400' },
    { icon: Store, title: t('landing.features.marketplace.title'), desc: t('landing.features.marketplace.desc'), gradient: 'from-amber-500 to-orange-400' },
    { icon: Activity, title: t('landing.features.monitoring.title'), desc: t('landing.features.monitoring.desc'), gradient: 'from-green-500 to-emerald-400' },
  ];

  const steps = [
    { icon: Sparkles, num: '01', title: t('landing.howItWorks.step1.title'), desc: t('landing.howItWorks.step1.desc') },
    { icon: Rocket, num: '02', title: t('landing.howItWorks.step2.title'), desc: t('landing.howItWorks.step2.desc') },
    { icon: MessageSquare, num: '03', title: t('landing.howItWorks.step3.title'), desc: t('landing.howItWorks.step3.desc') },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] overflow-hidden">
      {/* ===== Header ===== */}
      <header className="fixed top-0 w-full z-50 bg-[var(--bg-primary)]/80 backdrop-blur-xl border-b border-[var(--border)]/50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg overflow-hidden shadow-lg shadow-brand-500/25">
              <img src="/logo.png" alt="Logo" className="w-full h-full object-cover" />
            </div>
            <span className="font-bold text-xl text-[var(--text-primary)]">LOCAL BOT Web</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Language toggle */}
            <button
              onClick={() => i18n.changeLanguage(i18n.language === 'ko' ? 'en' : 'ko')}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border)] hover:bg-[var(--bg-tertiary)] transition-colors text-[var(--text-secondary)]"
            >
              {i18n.language === 'ko' ? 'EN' : ''}
            </button>
            {isAuthenticated ? (
              <button onClick={() => navigate('/sessions')} className="btn-primary">{t('nav.sessions')}</button>
            ) : (
              <Link to="/login" className="btn-primary">{t('auth.login')}</Link>
            )}
          </div>
        </div>
      </header>

      {/* ===== Hero ===== */}
      <section className="relative min-h-screen flex items-center justify-center px-6 pt-16">
        {/* Background layers */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0c1222] via-[var(--bg-primary)] to-[var(--bg-primary)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(99,102,241,0.12),transparent)]" />
        <ParticleField />

        {/* Floating glow orbs */}
        <motion.div
          className="absolute top-1/4 left-[15%] w-72 h-72 rounded-full bg-brand-500/10 blur-[100px]"
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 right-[10%] w-60 h-60 rounded-full bg-cyan-500/10 blur-[80px]"
          animate={{ scale: [1.1, 1, 1.1], opacity: [0.2, 0.4, 0.2] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        />

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-secondary)]/60 backdrop-blur text-sm text-[var(--text-secondary)] mb-8">
              <Zap size={14} className="text-[var(--accent)]" />
              <span>{t('landing.badge')}</span>
            </div>

            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold leading-[1.1] mb-6 tracking-tight">
              <span className="text-[var(--text-primary)]">{t('landing.hero.title')}</span>
              <br />
              <span className="bg-gradient-to-r from-brand-400 via-brand-500 to-cyan-400 bg-clip-text text-transparent">
                {t('landing.hero.titleHighlight')}
              </span>
            </h1>

            <p className="text-lg sm:text-xl text-[var(--text-secondary)] max-w-2xl mx-auto mb-12 leading-relaxed">
              {t('landing.hero.subtitle')}
            </p>

            <Link
              to={isAuthenticated ? '/sessions' : '/login'}
              className="inline-flex items-center gap-2 text-lg px-8 py-3.5 rounded-xl font-semibold
                bg-gradient-to-r from-brand-500 to-brand-600 text-white
                shadow-xl shadow-brand-500/30 hover:shadow-brand-500/50 hover:shadow-2xl
                hover:from-brand-400 hover:to-brand-500 active:scale-[0.98]
                transition-all duration-200"
            >
              {t('landing.hero.cta')}
              <ArrowRight size={20} />
            </Link>
          </motion.div>

          {/* Scroll indicator */}
          <motion.div
            className="absolute -bottom-16 left-1/2 -translate-x-1/2"
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <div className="w-6 h-10 rounded-full border-2 border-[var(--text-secondary)]/30 flex justify-center pt-2">
              <div className="w-1 h-2.5 rounded-full bg-[var(--text-secondary)]/50" />
            </div>
          </motion.div>
        </div>
      </section>

      {/* ===== Features ===== */}
      <Section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--text-primary)] mb-4">
              {t('landing.features.title')}
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {features.map((feat, i) => (
              <motion.div
                key={feat.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                viewport={{ once: true }}
                className={`${glassCard} p-8 group`}
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feat.gradient} flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300`}>
                  <feat.icon size={24} className="text-white" />
                </div>
                <h3 className="text-xl font-bold text-[var(--text-primary)] mb-3">{feat.title}</h3>
                <p className="text-[var(--text-secondary)] leading-relaxed">{feat.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ===== How It Works ===== */}
      <Section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--text-primary)] mb-4">
              {t('landing.howItWorks.title')}
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {steps.map((step, i) => (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.15, duration: 0.5 }}
                viewport={{ once: true }}
                className="relative text-center group"
              >
                {/* Connector line — dashed for visibility */}
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-10 left-[60%] w-[80%] border-t border-dashed border-[var(--accent)]/25" />
                )}
                <div className="relative inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--accent)]/25 mb-6 group-hover:scale-110 group-hover:border-[var(--accent)]/50 transition-all duration-300 shadow-lg shadow-[var(--accent)]/10">
                  <step.icon size={32} className="text-[var(--accent)]" />
                  {/* Subtle glow behind */}
                  <div className="absolute inset-0 rounded-2xl bg-[var(--accent)]/10 blur-xl -z-10" />
                </div>
                <div className="text-xs font-bold text-[var(--accent)] tracking-widest mb-2">{step.num}</div>
                <h3 className="text-lg font-bold text-[var(--text-primary)] mb-2">{step.title}</h3>
                <p className="text-[var(--text-secondary)] text-sm leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ===== Stats ===== */}
      <Section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--text-primary)]">
              {t('landing.stats.title')}
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { value: 1000, suffix: '+', label: t('landing.stats.users') },
              { value: 200, prefix: '<', suffix: 'ms', label: t('landing.stats.latency') },
              { value: 99.9, suffix: '%', label: t('landing.stats.uptime') },
              { value: 5000, suffix: '+', label: t('landing.stats.sessions') },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                viewport={{ once: true }}
                className={`${glassCard} p-6 text-center`}
              >
                <div className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-brand-400 to-cyan-400 bg-clip-text text-transparent mb-2">
                  {stat.value === 99.9 ? (
                    <span>{stat.value}{stat.suffix}</span>
                  ) : (
                    <Counter end={stat.value} suffix={stat.suffix} prefix={stat.prefix} />
                  )}
                </div>
                <div className="text-sm text-[var(--text-secondary)]">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </Section>

      {/* ===== CTA ===== */}
      <Section className="py-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="relative">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.08),transparent_70%)]" />
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--text-primary)] mb-6 relative">
              {t('landing.hero.cta')}
            </h2>
            <Link
              to={isAuthenticated ? '/sessions' : '/login'}
              className="relative inline-flex items-center gap-2 text-lg px-8 py-3.5 rounded-xl font-semibold
                bg-gradient-to-r from-brand-500 to-brand-600 text-white
                shadow-xl shadow-brand-500/30 hover:shadow-brand-500/50 hover:shadow-2xl
                hover:from-brand-400 hover:to-brand-500 active:scale-[0.98]
                transition-all duration-200"
            >
              {t('landing.hero.cta')}
              <ArrowRight size={20} />
            </Link>
          </div>
        </div>
      </Section>

      {/* ===== Footer ===== */}
      <footer className="border-t border-[var(--border)]/50 py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-[var(--text-secondary)] text-sm">
            <div className="w-6 h-6 rounded overflow-hidden">
              <img src="/logo.png" alt="Logo" className="w-full h-full object-cover" />
            </div>
            LOCAL BOT Web
          </div>
          <div className="flex items-center gap-6 text-sm text-[var(--text-secondary)]">
            <a href="https://github.com/A2G-Dev-Space/Local-CLI" target="_blank" rel="noopener noreferrer"
              className="hover:text-[var(--text-primary)] transition-colors flex items-center gap-1.5">
              <Github size={14} /> GitHub
            </a>
            <span>&copy; 2026 LOCAL BOT</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

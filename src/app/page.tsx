'use client';

import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { useSpeech } from '@/lib/hooks/useSpeech';
import type {
  ExaminerState,
  FinalEvaluation,
  TopicArea,
  InterviewType,
  ExperienceLevel,
} from '@/lib/agent/types';

type AppPhase = 'landing' | 'loading' | 'session' | 'complete';

// ─────────────────────────────────────────────
// SUBCOMPONENTS
// ─────────────────────────────────────────────

function WaveOrb({ status }: { status: string }) {
  const bars = Array.from({ length: 5 });
  return (
    <div className="relative flex items-center justify-center w-32 h-32">
      <div className={`absolute inset-0 rounded-full transition-all duration-700 ${
        status === 'speaking'
          ? 'bg-[radial-gradient(circle,rgba(200,184,154,0.15)_0%,transparent_70%)] animate-pulse-ring'
          : status === 'listening'
          ? 'bg-[radial-gradient(circle,rgba(76,175,125,0.15)_0%,transparent_70%)] animate-pulse-ring'
          : 'bg-transparent'
      }`} />
      <div className={`relative z-10 flex items-center justify-center w-20 h-20 rounded-full border transition-all duration-500 ${
        status === 'speaking'
          ? 'border-[var(--accent)] bg-[var(--glow)]'
          : status === 'listening'
          ? 'border-[var(--green)] bg-[rgba(76,175,125,0.05)]'
          : status === 'processing'
          ? 'border-[var(--yellow)] bg-[rgba(212,168,67,0.05)]'
          : 'border-[var(--border-bright)] bg-[var(--surface)]'
      }`}>
        {(status === 'speaking' || status === 'listening') ? (
          <div className="flex items-center gap-[3px]">
            {bars.map((_, i) => (
              <div key={i} className="w-[3px] rounded-full animate-wave"
                style={{
                  height: '20px',
                  animationDelay: `${i * 0.12}s`,
                  backgroundColor: status === 'speaking' ? 'var(--accent)' : 'var(--green)',
                }} />
            ))}
          </div>
        ) : status === 'processing' ? (
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-1 h-1 rounded-full bg-[var(--yellow)] animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        ) : (
          <div className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />
        )}
      </div>
    </div>
  );
}

function StatusLabel({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    idle: { label: 'ready', color: 'var(--text-muted)' },
    speaking: { label: 'sage is speaking...', color: 'var(--accent)' },
    listening: { label: 'listening...', color: 'var(--green)' },
    processing: { label: 'thinking...', color: 'var(--yellow)' },
  };
  const current = map[status] || map.idle;
  return (
    <p className="text-xs tracking-widest uppercase mt-3 transition-all duration-300"
      style={{ color: current.color }}>
      {current.label}
    </p>
  );
}

function ProgressTracker({ areas }: { areas: TopicArea[] }) {
  return (
    <div className="w-full max-w-md">
      <p className="text-xs text-[var(--text-secondary)] tracking-widest uppercase mb-3">
        Coverage
      </p>
      <div className="flex flex-col gap-2">
        {areas.map((area, i) => (
          <div key={area.id} className="flex items-center gap-3">
            <div className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] transition-all duration-500 ${
              area.covered
                ? 'border-[var(--green)] bg-[rgba(76,175,125,0.1)] text-[var(--green)]'
                : 'border-[var(--border-bright)] text-[var(--text-muted)]'
            }`}>
              {area.covered ? '✓' : i + 1}
            </div>
            <span className={`text-sm transition-all duration-300 ${
              area.covered ? 'text-[var(--text-secondary)] line-through' : 'text-[var(--text-primary)]'
            }`}>
              {area.name}
            </span>
            {area.score !== null && (
              <span className="ml-auto text-xs text-[var(--accent)]">{area.score}/10</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FeedbackBadge({ quality }: { quality: string | null }) {
  if (!quality) return null;
  const map: Record<string, { label: string; color: string }> = {
    strong: { label: '● Strong', color: 'var(--green)' },
    medium: { label: '◐ Medium', color: 'var(--yellow)' },
    weak: { label: '○ Needs Work', color: 'var(--red)' },
  };
  const current = map[quality];
  if (!current) return null;
  return (
    <span className="text-xs tracking-wide px-3 py-1 rounded-full border"
      style={{ color: current.color, borderColor: current.color, backgroundColor: `${current.color}15` }}>
      {current.label}
    </span>
  );
}

function EvaluationScreen({ evaluation, role, onRestart }: {
  evaluation: FinalEvaluation;
  role: string;
  onRestart: () => void;
}) {
  return (
    <div className="w-full max-w-lg animate-fade-in flex flex-col gap-6 py-12">
      {/* Header */}
      <div className="text-center">
        <p className="text-xs text-[var(--text-secondary)] tracking-widest uppercase mb-2">
          Interview Assessment — {role}
        </p>
        <div className="text-5xl font-light text-[var(--accent)] mb-1"
          style={{ fontFamily: 'DM Serif Display, serif' }}>
          {evaluation.readinessRating}
        </div>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed mt-3">
          {evaluation.summary}
        </p>
      </div>

      {/* Area scores */}
      <div className="border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
          <p className="text-xs text-[var(--text-secondary)] tracking-widest uppercase">
            Area Breakdown
          </p>
        </div>
        {evaluation.areaScores.map((area, i) => (
          <div key={i} className="px-4 py-3 border-b border-[var(--border)] last:border-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-[var(--text-primary)]">{area.areaName}</span>
              <span className="text-sm text-[var(--accent)]">{area.score}/10</span>
            </div>
            <div className="w-full h-[2px] bg-[var(--border)] rounded-full mb-2">
              <div className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: `${area.score * 10}%`,
                  backgroundColor: area.score >= 7 ? 'var(--green)' : area.score >= 4 ? 'var(--yellow)' : 'var(--red)',
                }} />
            </div>
            <p className="text-xs text-[var(--text-secondary)]">{area.feedback}</p>
          </div>
        ))}
      </div>

      {/* Strengths */}
      {evaluation.strengths.length > 0 && (
        <div className="border border-[var(--border)] rounded-lg p-4">
          <p className="text-xs text-[var(--green)] tracking-widest uppercase mb-3">
            What You Did Well
          </p>
          <ul className="flex flex-col gap-2">
            {evaluation.strengths.map((s, i) => (
              <li key={i} className="text-xs text-[var(--text-secondary)] flex gap-2">
                <span className="text-[var(--green)]">+</span> {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Weak moments */}
      {evaluation.weakMoments?.length > 0 && (
        <div className="border border-[var(--border)] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
            <p className="text-xs text-[var(--red)] tracking-widest uppercase">
              Weak Moments
            </p>
          </div>
          {evaluation.weakMoments.map((moment, i) => (
            <div key={i} className="px-4 py-4 border-b border-[var(--border)] last:border-0 flex flex-col gap-2">
              <p className="text-xs text-[var(--text-muted)] tracking-wide uppercase">Question</p>
              <p className="text-sm text-[var(--text-primary)]">"{moment.question}"</p>
              <p className="text-xs text-[var(--text-muted)] tracking-wide uppercase mt-1">Your Answer</p>
              <p className="text-sm text-[var(--text-secondary)] italic">"{moment.answer}"</p>
              <p className="text-xs text-[var(--text-muted)] tracking-wide uppercase mt-1">Why It Was Weak</p>
              <p className="text-xs text-[var(--red)]">{moment.whyWeak}</p>
              <p className="text-xs text-[var(--text-muted)] tracking-wide uppercase mt-1">How To Improve</p>
              <p className="text-xs text-[var(--yellow)]">{moment.howToImprove}</p>
            </div>
          ))}
        </div>
      )}

      {/* Recommendation */}
      <div className="border border-[var(--border-bright)] rounded-lg p-4 bg-[var(--glow)]">
        <p className="text-xs text-[var(--accent)] tracking-widest uppercase mb-2">
          Top Priority
        </p>
        <p className="text-sm text-[var(--text-primary)] leading-relaxed">
          {evaluation.recommendation}
        </p>
      </div>

      {/* Restart */}
      <button onClick={onRestart}
        className="w-full py-3 border border-[var(--border-bright)] rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-all duration-300 tracking-widest uppercase">
        Start New Session
      </button>
    </div>
  );
}

function FadeInSection({ children, className = '', delay = 0, style }: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.12 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} style={{
      ...style,
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(28px)',
      transition: `opacity 0.7s ease ${delay}ms, transform 0.7s ease ${delay}ms`,
    }}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────
// INTERVIEW FORM — owns its own local state so
// keystrokes never propagate up to Home
// ─────────────────────────────────────────────
const InterviewForm = memo(function InterviewForm({
  isVisible,
  onStart,
  onClose,
  unlockAudio,
  isSupported,
  error,
}: {
  isVisible: boolean;
  onStart: (role: string, expLevel: ExperienceLevel, intType: InterviewType) => void;
  onClose: () => void;
  unlockAudio: () => void;
  isSupported: boolean;
  error: string;
}) {
  const roleRef = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);

  const [roleHasValue, setRoleHasValue] = useState(false);
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>('junior');
  const [interviewType, setInterviewType] = useState<InterviewType>('behavioral');

  // Focus input and reset state each time the modal opens
  useEffect(() => {
    if (isVisible) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      roleRef.current = '';
      setRoleHasValue(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [isVisible]);

  const handleRoleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    roleRef.current = e.target.value;
    const next = e.target.value.trim().length > 0;
    setRoleHasValue(prev => prev === next ? prev : next);
  };

  const handleSubmit = () => {
    const role = roleRef.current.trim();
    if (!role) return;
    unlockAudio();
    onStart(role, experienceLevel, interviewType);
  };

  return (
    // Always in the DOM — visibility toggled via CSS so there's no mount cost on click
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{
        opacity: isVisible ? 1 : 0,
        pointerEvents: isVisible ? 'auto' : 'none',
        transition: 'opacity 0.15s ease',
      }}
    >
      {/* Backdrop — solid, no blur (blur is very GPU-expensive on large elements) */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.72)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="relative w-full sm:max-w-md border border-[var(--border-bright)] rounded-t-2xl sm:rounded-2xl p-6 sm:p-8 z-10 flex flex-col gap-5"
        style={{
          background: 'var(--surface)',
          transform: isVisible ? 'translateY(0)' : 'translateY(16px)',
          transition: 'transform 0.15s ease',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <div>
            <p className="text-base text-[var(--text-primary)]"
              style={{ fontFamily: 'DM Serif Display, serif' }}>
              Start your session
            </p>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">Configure your interview below</p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors text-lg leading-none">
            ✕
          </button>
        </div>

        {/* Role input — uncontrolled */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-[var(--text-secondary)] tracking-widest uppercase">
            Role you're interviewing for
          </label>
          <input
            ref={inputRef}
            type="text"
            defaultValue=""
            onChange={handleRoleChange}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="e.g. Software Engineer, Product Manager..."
            className="w-full border rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
            onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
          />
        </div>

        {/* Experience level */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-[var(--text-secondary)] tracking-widest uppercase">
            Experience level
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['junior', 'mid-level', 'senior'] as ExperienceLevel[]).map((level) => (
              <button key={level}
                onClick={() => setExperienceLevel(level)}
                className="py-2 rounded-lg text-xs tracking-widest uppercase transition-colors duration-100 border"
                style={{
                  borderColor: experienceLevel === level ? 'var(--accent)' : 'var(--border)',
                  color: experienceLevel === level ? 'var(--accent)' : 'var(--text-muted)',
                  background: experienceLevel === level ? 'var(--glow)' : 'transparent',
                }}>
                {level}
              </button>
            ))}
          </div>
        </div>

        {/* Interview type */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-[var(--text-secondary)] tracking-widest uppercase">
            Interview type
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['behavioral', 'technical', 'mixed'] as InterviewType[]).map((type) => (
              <button key={type}
                onClick={() => setInterviewType(type)}
                className="py-2 rounded-lg text-xs tracking-widest uppercase transition-colors duration-100 border"
                style={{
                  borderColor: interviewType === type ? 'var(--accent)' : 'var(--border)',
                  color: interviewType === type ? 'var(--accent)' : 'var(--text-muted)',
                  background: interviewType === type ? 'var(--glow)' : 'transparent',
                }}>
                {type}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-[var(--red)]">{error}</p>}

        {!isSupported && (
          <p className="text-xs text-[var(--red)]">
            Voice input is not available. Your browser may be too old, or try accessing the app over HTTPS.
          </p>
        )}

        <button
          onClick={handleSubmit}
          disabled={!roleHasValue}
          className="w-full py-3 rounded-lg text-sm tracking-widest uppercase transition-colors duration-100"
          style={{
            background: roleHasValue ? 'var(--accent)' : 'var(--surface)',
            color: roleHasValue ? 'var(--bg)' : 'var(--text-muted)',
            opacity: roleHasValue ? '1' : '0.3',
            cursor: roleHasValue ? 'pointer' : 'not-allowed',
          }}>
          Begin Interview
        </button>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────
// LANDING PAGE — memoized so it never re-renders
// while the form modal is open or being typed into
// ─────────────────────────────────────────────
const LandingPage = memo(function LandingPage({ onCtaClick }: { onCtaClick: () => void }) {
  return (
    <>
      {/* ── NAV ── */}
      <nav
        className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-6 sm:px-10 py-5 border-b"
        style={{ background: 'rgba(13,13,20,0.88)', backdropFilter: 'blur(20px)', borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <span className="text-2xl tracking-tight" style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--text-primary)' }}>
          Sage
        </span>
        <button
          onClick={onCtaClick}
          className="text-xs tracking-widest uppercase px-4 py-2 rounded-lg border transition-all duration-300 hover:text-[var(--accent)] hover:border-[var(--accent)]"
          style={{ borderColor: 'var(--border-bright)', color: 'var(--text-secondary)' }}
        >
          Get Started
        </button>
      </nav>

      {/* ── HERO ── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 text-center pt-24 pb-20 overflow-hidden">
        {/* Slow-moving radial gradient blobs — barely perceptible depth */}
        <div
          className="absolute inset-0 pointer-events-none animate-float-gradient"
          style={{
            background: 'radial-gradient(ellipse 80% 55% at 50% 65%, rgba(200,184,154,0.055) 0%, transparent 70%)',
            willChange: 'transform',
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 55% 45% at 25% 35%, rgba(124,58,237,0.065) 0%, transparent 70%)',
            animation: 'float-gradient 22s ease-in-out infinite reverse',
            willChange: 'transform',
          }}
        />

        <FadeInSection className="relative z-10 flex flex-col items-center gap-7 max-w-4xl">
          {/* Live badge */}
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border text-xs tracking-widest uppercase"
            style={{ background: 'rgba(13,13,20,0.9)', borderColor: 'rgba(200,184,154,0.22)', color: 'var(--text-secondary)' }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse-dot flex-shrink-0"
              style={{ background: '#00ff88', boxShadow: '0 0 8px rgba(0,255,136,0.55)' }}
            />
            AI Interview Coach
          </div>

          {/* Main headline */}
          <h1
            className="text-5xl sm:text-6xl md:text-7xl lg:text-[5.25rem] text-[var(--text-primary)] leading-[1.08] tracking-tight"
            style={{ fontFamily: 'DM Serif Display, serif' }}
          >
            Your AI Interview Coach
            <br />
            <span className="relative inline-block mt-1">
              That Actually Listens.
              {/* Hand-drawn style warm underline */}
              <svg
                className="absolute left-0 w-full pointer-events-none"
                style={{ bottom: '-10px', height: '14px' }}
                viewBox="0 0 520 14"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  d="M0,10 C45,4 100,13 170,8 C240,3 295,12 360,7 C425,2 470,11 520,7"
                  stroke="var(--accent)"
                  strokeWidth="2.5"
                  fill="none"
                  strokeLinecap="round"
                  opacity="0.8"
                />
              </svg>
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-sm sm:text-base leading-relaxed max-w-lg mt-1" style={{ color: 'var(--text-secondary)' }}>
            Sage conducts real adaptive interviews using your voice. It asks follow-up questions,
            scores your answers, and delivers a full evaluation — just like a real interviewer.
          </p>

          {/* CTA */}
          <div className="flex flex-col sm:flex-row items-center gap-4 mt-1">
            <button
              onClick={onCtaClick}
              className="btn-shimmer px-9 py-3.5 rounded-lg text-sm tracking-widest uppercase font-medium"
              style={{ background: 'var(--accent)', color: 'var(--bg)' }}
            >
              Start Practicing Free
            </button>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>No account · No credit card</span>
          </div>

          {/* Social proof stats */}
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mt-1">
            <span className="text-[11px] tracking-wide" style={{ color: 'var(--text-muted)' }}>2,400+ sessions completed</span>
            <span style={{ color: 'var(--text-muted)' }}>·</span>
            <span className="text-[11px] tracking-wide" style={{ color: 'var(--text-muted)' }}>94% reported feeling more confident</span>
          </div>
        </FadeInSection>

        {/* Scroll indicator */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-20 pointer-events-none">
          <div className="w-px h-8" style={{ background: 'var(--border-bright)' }} />
          <span className="text-[10px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>scroll</span>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="px-6 py-28 flex flex-col items-center border-t" style={{ borderColor: 'var(--border)' }}>
        <FadeInSection className="flex flex-col items-center gap-14 w-full max-w-5xl">
          <div className="text-center">
            <p className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--accent)' }}>Process</p>
            <h2
              className="text-3xl sm:text-4xl"
              style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--text-primary)' }}
            >
              How It Works
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 w-full">
            {[
              {
                step: '01',
                title: 'Choose your role and level',
                body: 'Pick the job title and experience level you\'re targeting. Every question is tailored to your exact context.',
              },
              {
                step: '02',
                title: 'Speak your answers out loud',
                body: 'Sage listens, adapts in real time, and follows up like a real interviewer — no scripted question lists.',
              },
              {
                step: '03',
                title: 'Get your weak spots identified',
                body: 'Receive a full scored evaluation with exact feedback on what fell short and how to fix it.',
              },
            ].map(({ step, title, body }, i) => (
              <FadeInSection key={step} delay={i * 100}>
                <div
                  className="relative overflow-hidden rounded-xl p-7 h-full flex flex-col gap-5 border-t border-r border-b"
                  style={{
                    background: 'var(--surface)',
                    borderTopColor: 'var(--border)',
                    borderRightColor: 'var(--border)',
                    borderBottomColor: 'var(--border)',
                    borderLeft: '2px solid rgba(200,184,154,0.45)',
                  }}
                >
                  {/* Large faded watermark number */}
                  <span
                    className="absolute -top-3 right-4 select-none pointer-events-none leading-none"
                    style={{
                      fontFamily: 'DM Serif Display, serif',
                      fontSize: '7rem',
                      color: 'var(--text-primary)',
                      opacity: 0.035,
                    }}
                    aria-hidden="true"
                  >
                    {step}
                  </span>

                  <span className="text-xs tracking-widest" style={{ color: 'var(--accent)' }}>{step}</span>
                  <h3 className="text-base leading-snug" style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--text-primary)' }}>
                    {title}
                  </h3>
                  <p className="text-xs leading-relaxed mt-auto" style={{ color: 'var(--text-secondary)' }}>{body}</p>
                </div>
              </FadeInSection>
            ))}
          </div>
        </FadeInSection>
      </section>

      {/* ── WHAT MAKES SAGE DIFFERENT ── */}
      <section className="px-6 py-28 flex flex-col items-center border-t" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <FadeInSection className="flex flex-col items-center gap-14 w-full max-w-5xl">
          <div className="text-center">
            <p className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--accent)' }}>Why Sage</p>
            <h2
              className="text-3xl sm:text-4xl"
              style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--text-primary)' }}
            >
              What Makes Sage Different
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 w-full">
            {[
              {
                title: 'Truly Adaptive',
                body: "Sage doesn't read from a question bank. It listens to what you actually say and decides what to probe next.",
                icon: '✦',
              },
              {
                title: 'Voice First',
                body: "Practice the way you'll actually interview — speaking out loud, not typing into a chat window.",
                icon: '◉',
              },
              {
                title: 'Real Feedback',
                body: 'Every answer is scored 0–10 with specific reasoning. No generic advice. No filler.',
                icon: '◆',
              },
            ].map(({ title, body, icon }, i) => (
              <FadeInSection key={title} delay={i * 100}>
                <div className="glass-card rounded-xl p-7 flex flex-col gap-5 h-full">
                  <span className="text-3xl" style={{ color: 'var(--accent)' }}>{icon}</span>
                  <h3 className="text-base leading-snug" style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--text-primary)' }}>
                    {title}
                  </h3>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{body}</p>
                </div>
              </FadeInSection>
            ))}
          </div>
        </FadeInSection>
      </section>

      {/* ── SOCIAL PROOF ── */}
      <section className="px-6 py-28 flex flex-col items-center border-t" style={{ borderColor: 'var(--border)' }}>
        <FadeInSection className="w-full max-w-lg">
          <div
            className="rounded-2xl p-8 flex flex-col gap-5"
            style={{ background: 'var(--surface)', border: '1px solid var(--border-bright)' }}
          >
            {/* Quote mark */}
            <span
              className="text-5xl leading-none select-none"
              style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--accent)', opacity: 0.45 }}
              aria-hidden="true"
            >
              "
            </span>

            <blockquote
              className="text-base sm:text-lg leading-relaxed"
              style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--text-primary)' }}
            >
              I used Sage the night before my interview and it caught weaknesses in my answers
              I didn't even realize I had.
            </blockquote>

            {/* Author row */}
            <div className="flex items-center gap-3 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
              {/* Avatar */}
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, var(--accent-dim), var(--accent))', color: 'var(--bg)' }}
              >
                SK
              </div>
              <div className="flex flex-col">
                <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Sarah K.</span>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Software Developer</span>
              </div>
              {/* Verified badge */}
              <div
                className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] tracking-wide"
                style={{
                  background: 'rgba(76,175,125,0.1)',
                  color: 'var(--green)',
                  border: '1px solid rgba(76,175,125,0.2)',
                }}
              >
                <span>✓</span>
                <span>Verified</span>
              </div>
            </div>
          </div>
        </FadeInSection>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="relative px-6 py-28 flex flex-col items-center border-t overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        {/* Centered radial glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(200,184,154,0.07) 0%, transparent 70%)' }}
        />
        <FadeInSection className="relative z-10 flex flex-col items-center gap-6 max-w-xl text-center">
          <h2
            className="text-3xl sm:text-4xl md:text-5xl leading-tight tracking-tight"
            style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--text-primary)' }}
          >
            Stop rehearsing.<br />Start performing.
          </h2>
          <p className="text-sm leading-relaxed max-w-sm" style={{ color: 'var(--text-secondary)' }}>
            One session is enough to know exactly what you need to work on.
            No signup, no credit card.
          </p>
          <button
            onClick={onCtaClick}
            className="btn-shimmer mt-2 px-9 py-3.5 rounded-lg text-sm tracking-widest uppercase font-medium"
            style={{ background: 'var(--accent)', color: 'var(--bg)' }}
          >
            Start Your Free Session
          </button>
        </FadeInSection>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t px-6 py-8 flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
        <span className="text-sm" style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--text-muted)' }}>
          Sage
        </span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>AI-powered interview practice</span>
      </footer>
    </>
  );
});

// ─────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────
export default function Home() {
  const [appPhase, setAppPhase] = useState<AppPhase>('landing');
  // role/experienceLevel/interviewType are set once at interview start, not per-keystroke
  const [role, setRole] = useState('');
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>('mid-level');
  const [interviewType, setInterviewType] = useState<InterviewType>('mixed');
  const [agentState, setAgentState] = useState<ExaminerState | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [topicAreas, setTopicAreas] = useState<TopicArea[]>([]);
  const [quality, setQuality] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loadingMsg, setLoadingMsg] = useState('');
  const [showForm, setShowForm] = useState(false);

  const agentStateRef = useRef<ExaminerState | null>(null);
  const isMobile = useRef(false);

  useEffect(() => {
    isMobile.current =
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
      window.innerWidth < 768;
  }, []);

  const handleShowForm = useCallback(() => setShowForm(true), []);
  const handleHideForm = useCallback(() => setShowForm(false), []);

  const handleTranscript = useCallback(async (text: string) => {
    if (!agentStateRef.current) return;
    setQuality(null);

    try {
      // Step 1 — evaluate and get next question from agent
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'answer',
          answer: text,
          state: agentStateRef.current,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      agentStateRef.current = data.state;
      setAgentState(data.state);
      setQuality(data.quality);
      setTopicAreas(data.topicAreas);

      if (data.phase === 'complete') {
        setAppPhase('complete');
        cancel();
        return;
      }

      // Step 2 — prefetch audio and show question at the same time
      const nextQuestion = data.question;

      const audioRes = await fetch('/api/tts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: nextQuestion }),
});

const audioBlob = await audioRes.blob();
setCurrentQuestion(nextQuestion);
speakBlob(audioBlob);

    } catch (err) {
      console.error(err);
      setError('Something went wrong. Please try again.');
    }
  }, []);

  const handleSpeakEnd = useCallback(() => {}, []);

  const { status, transcript, isSupported, silenceCountdown, speechMode, isRecording, micError, speakBlob, startListening, stopListening, unlockAudio, cancel } = useSpeech({
    onTranscript: handleTranscript,
    onSpeakEnd: handleSpeakEnd,
  });

  // Gate mobile buttons: don't show until the first question has actually played.
  // Without this, "Tap to Answer" flashes during the TTS fetch before question 1.
  const [questionHasPlayed, setQuestionHasPlayed] = useState(false);
  useEffect(() => {
    if (appPhase === 'session' && status === 'speaking') setQuestionHasPlayed(true);
  }, [appPhase, status]);

  const handleStart = useCallback(async (
    formRole: string,
    formExpLevel: ExperienceLevel,
    formIntType: InterviewType,
  ) => {
    // Commit form values to Home state (used by session/complete display)
    setRole(formRole);
    setExperienceLevel(formExpLevel);
    setInterviewType(formIntType);

    setError('');
    setShowForm(false);
    setAppPhase('loading');
    setLoadingMsg('Analyzing role requirements...');

    try {
      setTimeout(() => setLoadingMsg('Building interview areas...'), 1200);
      setTimeout(() => setLoadingMsg('Preparing first question...'), 2400);

      const topic = `${formRole} — ${formIntType} interview — ${formExpLevel} level`;

      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          topic,
          role: formRole,
          experienceLevel: formExpLevel,
          interviewType: formIntType,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      agentStateRef.current = data.state;
      setAgentState(data.state);
      setTopicAreas(data.topicAreas);
      setCurrentQuestion(data.question);
      setAppPhase('session');

      // Fetch TTS and play as a detached background task.
      // Keeping this outside the awaited flow means a TTS failure can never
      // trigger the catch block and send the user back to the landing page.
      fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: data.question }),
      })
        .then(r => r.blob())
        .then(blob => speakBlob(blob))
        .catch(err => console.error('[TTS Error - first question]', err));

    } catch (err: any) {
      setError(err.message || 'Failed to start. Check your API key.');
      setShowForm(true);
      setAppPhase('landing');
    }
  }, [speakBlob]);

  const handleRestart = () => {
    cancel();
    setAppPhase('landing');
    setRole('');
    setExperienceLevel('mid-level');
    setInterviewType('mixed');
    setAgentState(null);
    setCurrentQuestion('');
    setTopicAreas([]);
    setQuality(null);
    setError('');
    setShowForm(false);
    setQuestionHasPlayed(false);
    agentStateRef.current = null;
  };

  return (
    <main className={appPhase === 'landing'
      ? 'min-h-screen'
      : 'min-h-screen flex flex-col items-center justify-center px-6 py-12'
    } style={{ background: 'var(--bg)' }}>

      {/* ── LANDING (marketing page) ── */}
      {appPhase === 'landing' && (
        <>
          <LandingPage onCtaClick={handleShowForm} />
          {/* Always mounted — visibility toggled with CSS to avoid mount cost on click */}
          <InterviewForm
            isVisible={showForm}
            onStart={handleStart}
            onClose={handleHideForm}
            unlockAudio={unlockAudio}
            isSupported={isSupported}
            error={error}
          />
        </>
      )}

      {/* ── LOADING ── */}
      {appPhase === 'loading' && (
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
          <p className="text-xs text-[var(--text-secondary)] tracking-widest uppercase animate-blink">
            {loadingMsg}
          </p>
        </div>
      )}

      {/* ── SESSION ── */}
      {appPhase === 'session' && (
        <div className="flex flex-col items-center gap-8 w-full max-w-md animate-fade-in">
          <div className="text-center">
            <p className="text-xs text-[var(--text-secondary)] tracking-widest uppercase mb-1">
              {interviewType} interview
            </p>
            <p className="text-sm text-[var(--text-primary)]">{role} — {experienceLevel}</p>
          </div>

          {topicAreas.length > 0 && <ProgressTracker areas={topicAreas} />}

          <div className="flex flex-col items-center">
            <WaveOrb status={status} />
            <StatusLabel status={status} />
          </div>

          {currentQuestion && (
            <div className="w-full border border-[var(--border)] rounded-lg p-4 bg-[var(--surface)] animate-slide-up">
              <p className="text-xs text-[var(--text-secondary)] tracking-widest uppercase mb-2">
                Question
              </p>
              <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                {currentQuestion}
              </p>
            </div>
          )}

          {quality && (
            <div className="flex justify-center animate-fade-in">
              <FeedbackBadge quality={quality} />
            </div>
          )}

          {transcript && (
            <div className="w-full animate-slide-up">
              <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--surface)]">
                <p className="text-xs text-[var(--text-secondary)] tracking-widest uppercase mb-2">
                  You said
                </p>
                <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                  "{transcript}"
                </p>
              </div>
            </div>
          )}

          {/* Silence countdown */}
          {status === 'listening' && silenceCountdown !== null && (
            <div className="flex flex-col items-center gap-1 animate-fade-in">
              <p className="text-xs text-[var(--text-secondary)] tracking-widest uppercase">
                submitting in
              </p>
              <p className="text-2xl text-[var(--accent)]"
                style={{ fontFamily: 'DM Serif Display, serif' }}>
                {silenceCountdown}
              </p>
            </div>
          )}

          {/* Mic error — shown when getUserMedia fails */}
          {micError && (
            <p className="text-xs text-center px-4" style={{ color: 'var(--red)' }}>
              {micError}
            </p>
          )}

          {/* MediaRecorder mode (phone): tap-to-start after a question has played,
               tap-to-submit while recording. Both are direct user gestures (required by iOS). */}
          {speechMode === 'mediaRecorder' && questionHasPlayed && status === 'idle' && (
            <button
              onClick={startListening}
              className="flex items-center gap-2 px-6 py-3 rounded-full border text-sm tracking-widest uppercase"
              style={{
                borderColor: 'var(--green)',
                color: 'var(--green)',
                background: 'rgba(76,175,125,0.06)',
              }}>
              <span className="w-2 h-2 rounded-full bg-[var(--green)]" />
              Tap to Answer
            </button>
          )}
          {/* Only show "Done Speaking" when MediaRecorder is actually capturing —
               not during the brief status='listening' transition after audio ends. */}
          {speechMode === 'mediaRecorder' && isRecording && (
            <button
              onClick={stopListening}
              className="flex items-center gap-2 px-6 py-3 rounded-full border text-sm tracking-widest uppercase"
              style={{
                borderColor: 'var(--accent)',
                color: 'var(--accent)',
                background: 'rgba(200,184,154,0.06)',
              }}>
              <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
              Done Speaking
            </button>
          )}

          {/* Web Speech fallback: only shown if recognition drops on mobile */}
          {speechMode === 'webSpeech' && isMobile.current && status === 'idle' && (
            <button
              onClick={startListening}
              className="flex items-center gap-2 px-6 py-3 rounded-full border text-sm tracking-widest uppercase"
              style={{
                borderColor: 'var(--green)',
                color: 'var(--green)',
                background: 'rgba(76,175,125,0.06)',
              }}>
              <span className="w-2 h-2 rounded-full bg-[var(--green)]" />
              Tap to Answer
            </button>
          )}

          <button onClick={handleRestart}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-all duration-300 tracking-widest uppercase">
            End Session
          </button>
        </div>
      )}

      {/* ── COMPLETE ── */}
      {appPhase === 'complete' && agentState?.finalEvaluation && (
        <EvaluationScreen
          evaluation={agentState.finalEvaluation}
          role={role}
          onRestart={handleRestart}
        />
      )}
    </main>
  );
}
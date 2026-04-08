'use client';

import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { useSpeech } from '@/lib/hooks/useSpeech';
import { useRealtimeSession } from '@/lib/hooks/useRealtimeSession';
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
  const [error, setError] = useState('');
  const [loadingMsg, setLoadingMsg] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [topicAreas, setTopicAreas] = useState<any[]>([]);

  const agentStateRef = useRef<ExaminerState | null>(null);
  const isMobile = useRef(false);

  useEffect(() => {
    isMobile.current =
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
      window.innerWidth < 768;
  }, []);

  const handleShowForm = useCallback(() => {
    setShowForm(true);
    // Warm up TTS pipeline with a silent call to eliminate first-question cold start
    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '.' }),
    }).catch(() => {}); // Ignore errors - this is just a warmup
  }, []);
  const handleHideForm = useCallback(() => setShowForm(false), []);

  // Legacy handleTranscript - kept for useSpeech hook compatibility but not used in Realtime flow
  const handleTranscript = useCallback(async (text: string) => {
    if (!agentStateRef.current) return;

    const t0 = performance.now();
    console.log(`[TIMING] handleTranscript: User answer received at ${t0.toFixed(2)}ms`);

    try {
      // Step 1 — evaluate and get next question from agent
      const t1 = performance.now();
      console.log(`[TIMING] handleTranscript: Starting agent fetch at ${t1.toFixed(2)}ms (+${(t1-t0).toFixed(2)}ms)`);

      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'answer',
          answer: text,
          state: agentStateRef.current,
        }),
      });

      const t2 = performance.now();
      console.log(`[TIMING] handleTranscript: Agent response received at ${t2.toFixed(2)}ms (+${(t2-t1).toFixed(2)}ms)`);

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const t3 = performance.now();
      console.log(`[TIMING] handleTranscript: Agent JSON parsed at ${t3.toFixed(2)}ms (+${(t3-t2).toFixed(2)}ms)`);

      agentStateRef.current = data.state;
      setAgentState(data.state);
      setTopicAreas(data.topicAreas);

      if (data.phase === 'complete') {
        setAppPhase('complete');
        cancel();
        return;
      }

      // Step 2 — show question immediately, fetch and play audio in parallel
      const nextQuestion = data.question;
      setCurrentQuestion(nextQuestion);

      const t4 = performance.now();
      console.log(`[TIMING] handleTranscript: Question text ready: "${nextQuestion.substring(0, 50)}..." at ${t4.toFixed(2)}ms (+${(t4-t3).toFixed(2)}ms)`);
      console.log(`[TIMING] handleTranscript: Starting TTS fetch at ${t4.toFixed(2)}ms`);

      // Fire TTS fetch and playback asynchronously with streaming
      // Stream receives audio progressively from OpenAI, reducing latency
      fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: nextQuestion }),
      })
        .then(async r => {
          const t5 = performance.now();
          console.log(`[TIMING] handleTranscript: TTS stream started at ${t5.toFixed(2)}ms (+${(t5-t4).toFixed(2)}ms)`);

          const reader = r.body?.getReader();
          if (!reader) {
            const blob = await r.blob();
            const t6 = performance.now();
            console.log(`[TIMING] handleTranscript: Complete audio (${blob.size} bytes) at ${t6.toFixed(2)}ms`);
            speakBlob(blob);
            return;
          }

          // Collect all chunks - streaming from OpenAI still reduces backend latency
          const chunks: BlobPart[] = [];
          let receivedLength = 0;
          let firstChunkTime: number | null = null;

          while (true) {
            const { done, value } = await reader.read();

            if (value) {
              if (!firstChunkTime) {
                firstChunkTime = performance.now();
                console.log(`[TIMING] handleTranscript: First chunk received at ${firstChunkTime.toFixed(2)}ms (+${(firstChunkTime-t5).toFixed(2)}ms)`);
              }
              chunks.push(value);
              receivedLength += value.length;
            }

            if (done) {
              const t6 = performance.now();
              console.log(`[TIMING] handleTranscript: Stream complete (${receivedLength} bytes) at ${t6.toFixed(2)}ms (+${(t6-t5).toFixed(2)}ms)`);

              // Create complete blob and play - speech recognition won't start until audio ends
              const blob = new Blob(chunks, { type: 'audio/mpeg' });
              const t7 = performance.now();
              console.log(`[TIMING] handleTranscript: Blob ready (${blob.size} bytes) at ${t7.toFixed(2)}ms, calling speakBlob`);
              speakBlob(blob);
              break;
            }
          }
        })
        .catch(err => console.error('[TTS Error]', err));

    } catch (err) {
      console.error(err);
      setError('Something went wrong. Please try again.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSpeakEnd = useCallback(() => {}, []);

  const { status, isSupported, silenceCountdown, speechMode, isRecording, micError, speakBlob, startListening, stopListening, unlockAudio, cancel } = useSpeech({
    onTranscript: handleTranscript,
    onSpeakEnd: handleSpeakEnd,
  });

  // ── Realtime API Session ─────────────────────
  const realtimeSession = useRealtimeSession({
    onQuestionReceived: (question) => {
      setCurrentQuestion(question);
    },
    onTranscriptUpdate: (transcript) => {
      setTranscript(transcript);
    },
    onResponseStart: () => {
      console.log('[Realtime] Sage started speaking');
    },
    onResponseEnd: () => {
      console.log('[Realtime] Sage finished speaking');
    },
    onSessionReady: () => {
      console.log('[Realtime] Session ready - Sage should begin speaking');
    },
    onError: (err) => {
      console.error('[Realtime] Error:', err);
      setError(err);
    },
    onInterviewComplete: () => {
      console.log('[Realtime] Interview complete');
      // Generate final evaluation and move to complete phase
      handleInterviewComplete();
    },
  });

  const handleInterviewComplete = useCallback(async () => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[handleInterviewComplete] STARTING EVALUATION');
    console.log('[handleInterviewComplete] Exchanges accumulated:', realtimeSession.exchanges.length);
    console.log('[handleInterviewComplete] Exchanges:', JSON.stringify(realtimeSession.exchanges, null, 2));

    // If not already disconnected (e.g., manual force end), disconnect now
    if (realtimeSession.status !== 'disconnected') {
      console.log('[handleInterviewComplete] Manually triggered - disconnecting WebSocket');
      realtimeSession.disconnect();
    }

    // Safety check - ensure we have at least some exchanges to evaluate
    if (realtimeSession.exchanges.length === 0) {
      console.error('[handleInterviewComplete] ❌ No exchanges to evaluate');
      setError('Interview ended prematurely - no answers recorded');
      setAppPhase('landing');
      return;
    }

    try {
      const requestPayload = {
        exchanges: realtimeSession.exchanges,
        role,
        experienceLevel,
        interviewType,
        topicAreas: realtimeSession.topicAreas,
      };

      console.log('[handleInterviewComplete] 📤 Sending to /api/realtime/conclude:');
      console.log(JSON.stringify(requestPayload, null, 2));

      // Generate final evaluation using accumulated exchanges
      const res = await fetch('/api/realtime/conclude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      });

      const data = await res.json();

      console.log('[handleInterviewComplete] 📥 Response from /api/realtime/conclude:');
      console.log('Status:', res.status, res.ok ? '✅' : '❌');
      console.log('Data:', JSON.stringify(data, null, 2));

      if (!res.ok) throw new Error(data.error);

      console.log('[handleInterviewComplete] ✅ Evaluation received successfully');
      console.log('[handleInterviewComplete] Setting agentState with finalEvaluation');
      console.log('[handleInterviewComplete] Transitioning to phase: complete');

      // Update agent state with final evaluation
      setAgentState({
        ...agentStateRef.current!,
        finalEvaluation: data.finalEvaluation,
        overallScore: data.finalEvaluation.overallScore,
        phase: 'complete',
      } as ExaminerState);

      setAppPhase('complete');
      console.log('[handleInterviewComplete] ✅ Phase transition to complete successful');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    } catch (err) {
      console.error('[handleInterviewComplete Error] ❌', err);
      setError('Failed to generate evaluation. Please try again.');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
  }, [realtimeSession, role, experienceLevel, interviewType]);


  const handleStart = useCallback(async (
    formRole: string,
    formExpLevel: ExperienceLevel,
    formIntType: InterviewType,
  ) => {
    const t0 = performance.now();
    console.log(`[TIMING] handleStart: Begin Interview clicked at ${t0.toFixed(2)}ms`);

    // Commit form values to Home state (used by session/complete display)
    setRole(formRole);
    setExperienceLevel(formExpLevel);
    setInterviewType(formIntType);

    setError('');
    setShowForm(false);
    setAppPhase('loading');
    setLoadingMsg('Analyzing role requirements...');

    try {
      setTimeout(() => setLoadingMsg('Building interview areas...'), 800);
      setTimeout(() => setLoadingMsg('Connecting to Sage...'), 1600);

      const topic = `${formRole} — ${formIntType} interview — ${formExpLevel} level`;

      const t1 = performance.now();
      console.log(`[TIMING] handleStart: Initializing topic areas at ${t1.toFixed(2)}ms`);

      // Initialize topic areas
      const initRes = await fetch('/api/realtime/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
      });

      const initData = await initRes.json();
      if (!initRes.ok) throw new Error(initData.error);

      const topicAreas = initData.topicAreas;
      const t2 = performance.now();
      console.log(`[TIMING] handleStart: Topic areas initialized at ${t2.toFixed(2)}ms (+${(t2-t1).toFixed(2)}ms)`);

      // Initialize Realtime session with topic areas
      realtimeSession.initializeInterview(topicAreas);
      setTopicAreas(topicAreas);

      // Build system prompt for Sage
      const areasList = topicAreas.map((a: any, i: number) => `${i+1}. ${a.name}`).join('\n');

      const systemPrompt = `You are Sage, a senior interviewer at a top tech company conducting a ${formIntType} interview for a ${formRole} position. The candidate's experience level is ${formExpLevel}.

Your task is to assess the candidate's knowledge across these 3 areas:
${areasList}

Interview Guidelines:
- Ask ONE question at a time and wait for the candidate to finish speaking before responding
- Start with the first area and progress naturally through all three
- MANDATORY: Ask at least 2 questions per topic area before moving to the next area
- MANDATORY: Cover ALL 3 topic areas before concluding the interview
- If a candidate's answer is under 15 words, it is incomplete — ask them to elaborate or provide more detail
- Strong answers: acknowledge briefly and ask one more question in this area before moving on
- Medium answers: ask ONE clarifying follow-up to probe deeper
- Weak answers: ask a more foundational question to assess basics
- Transition naturally between areas (e.g., "Let's talk about [next area]...")
- Total interview should be 6-8 questions across all 3 areas

Be conversational and human-like:
- Short, direct questions (max 2 sentences)
- Never start with "Can you", "Could you", "Would you mind"
- Avoid filler words like "elaborate", "explain in detail", "walk me through"
- Sound like a real interviewer, not a chatbot
- No encouragement or praise - stay professional and neutral

Completion Rules (ALL must be true before concluding):
1. You have covered ALL 3 topic areas
2. You have asked at least 2 questions per topic area
3. The candidate has provided substantive answers (not just 1-2 word responses)
4. You have asked a total of at least 6 questions

When ALL completion rules are met, say: "That wraps up our interview today. Thank you for your time." This signals the end.

IMPORTANT: Begin the interview immediately when the session starts. Say a brief greeting like "Hi, I'm Sage. Let's get started." and then ask your first question about ${topicAreas[0].name}. Do not wait for the candidate to speak first.`;

      const t3 = performance.now();
      console.log(`[TIMING] handleStart: Connecting to Realtime API at ${t3.toFixed(2)}ms`);

      // Connect to Realtime API with system prompt - this waits for session.updated
      await realtimeSession.connect(systemPrompt);

      const t4 = performance.now();
      console.log(`[TIMING] handleStart: Realtime session ready at ${t4.toFixed(2)}ms (+${(t4-t3).toFixed(2)}ms)`);

      // Now safe to start audio capture - WebSocket is fully connected and configured
      await realtimeSession.startAudioCapture();

      const t5 = performance.now();
      console.log(`[TIMING] handleStart: Audio capture started at ${t5.toFixed(2)}ms (+${(t5-t4).toFixed(2)}ms)`);

      // Move to session phase
      setAppPhase('session');

      console.log(`[TIMING] handleStart: Total initialization time: ${(t5-t0).toFixed(2)}ms`);

    } catch (err: any) {
      console.error('[handleStart Error]', err);
      setError(err.message || 'Failed to start. Check your API key.');
      setShowForm(true);
      setAppPhase('landing');
    }
  }, [realtimeSession]);

  const handleRestart = () => {
    cancel();
    realtimeSession.disconnect();
    setAppPhase('landing');
    setRole('');
    setExperienceLevel('mid-level');
    setInterviewType('mixed');
    setAgentState(null);
    setCurrentQuestion('');
    setTopicAreas([]);
    setTranscript('');
    setError('');
    setShowForm(false);
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

          {realtimeSession.topicAreas.length > 0 && <ProgressTracker areas={realtimeSession.topicAreas} />}

          <div className="flex flex-col items-center">
            <WaveOrb status={realtimeSession.isSageSpeaking ? 'speaking' : realtimeSession.isUserSpeaking ? 'listening' : 'idle'} />
            <StatusLabel status={realtimeSession.isSageSpeaking ? 'speaking' : realtimeSession.isUserSpeaking ? 'listening' : 'idle'} />

            {/* Silence indicator - show when user was speaking but stopped */}
            {!realtimeSession.isSageSpeaking && !realtimeSession.isUserSpeaking && realtimeSession.currentTranscript && (
              <div className="mt-2 flex items-center gap-2 animate-pulse">
                <div className="w-2 h-2 rounded-full bg-[var(--yellow)]" />
                <p className="text-xs text-[var(--yellow)] tracking-widest uppercase">
                  Processing...
                </p>
              </div>
            )}
          </div>

          {realtimeSession.currentQuestion && (
            <div className="w-full border border-[var(--border)] rounded-lg p-4 bg-[var(--surface)] animate-slide-up">
              <p className="text-xs text-[var(--text-secondary)] tracking-widest uppercase mb-2">
                Question
              </p>
              <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                {realtimeSession.currentQuestion}
              </p>
            </div>
          )}

          {realtimeSession.currentTranscript && (
            <div className="w-full animate-slide-up">
              <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--surface)]">
                <p className="text-xs text-[var(--text-secondary)] tracking-widest uppercase mb-2">
                  You're saying
                </p>
                <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                  "{realtimeSession.currentTranscript}"
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-6 mt-4">
            <button onClick={handleInterviewComplete}
              className="text-xs text-[var(--yellow)] hover:text-[var(--yellow)]/80 transition-all duration-300 tracking-widest uppercase border border-[var(--yellow)]/30 px-3 py-1.5 rounded"
              title="Testing only - manually trigger evaluation report">
              Force End Interview
            </button>
            <button onClick={handleRestart}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-all duration-300 tracking-widest uppercase">
              End Session
            </button>
          </div>
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


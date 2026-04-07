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
    setRoleHasValue(e.target.value.trim().length > 0);
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
          className="w-full py-3 rounded-lg text-sm tracking-widest uppercase transition-all duration-150"
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
      {/* NAV */}
      <nav className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-6 sm:px-10 py-4 border-b border-[var(--border)]"
        style={{ background: 'rgba(10,10,10,0.85)', backdropFilter: 'blur(12px)' }}>
        <span className="text-xl text-[var(--text-primary)]"
          style={{ fontFamily: 'DM Serif Display, serif' }}>
          Sage
        </span>
        <button
          onClick={onCtaClick}
          className="text-xs tracking-widest uppercase px-4 py-2 rounded-lg border border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-all duration-300">
          Get Started
        </button>
      </nav>

      {/* ── HERO ── */}
      <section className="min-h-screen flex flex-col items-center justify-center px-6 text-center pt-24 pb-20">
        <FadeInSection className="flex flex-col items-center gap-6 max-w-2xl">
          <p className="text-xs tracking-widest uppercase text-[var(--accent)] border border-[var(--accent)] border-opacity-30 px-3 py-1 rounded-full"
            style={{ borderColor: 'rgba(200,184,154,0.25)' }}>
            AI Interview Coach
          </p>
          <h1 className="text-4xl sm:text-5xl md:text-6xl text-[var(--text-primary)] leading-tight"
            style={{ fontFamily: 'DM Serif Display, serif' }}>
            Your AI Interview Coach<br className="hidden sm:block" /> That Actually Listens
          </h1>
          <p className="text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed max-w-xl">
            Sage conducts real adaptive interviews using your voice. It asks follow-up questions,
            scores your answers, and gives you a full evaluation report — just like a real interviewer would.
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-3 mt-2">
            <button
              onClick={onCtaClick}
              className="px-8 py-3 rounded-lg text-sm tracking-widest uppercase transition-all duration-300 hover:opacity-90"
              style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
              Start Practicing Free
            </button>
            <span className="text-xs text-[var(--text-muted)]">No account needed</span>
          </div>
        </FadeInSection>

        {/* Subtle scroll indicator */}
        <div className="absolute bottom-10 flex flex-col items-center gap-2 opacity-30">
          <div className="w-px h-8 bg-[var(--border-bright)]" />
          <span className="text-[10px] tracking-widest uppercase text-[var(--text-muted)]">scroll</span>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="px-6 py-24 flex flex-col items-center border-t border-[var(--border)]">
        <FadeInSection className="flex flex-col items-center gap-12 w-full max-w-4xl">
          <div className="text-center">
            <p className="text-xs tracking-widest uppercase text-[var(--accent)] mb-3">Process</p>
            <h2 className="text-2xl sm:text-3xl text-[var(--text-primary)]"
              style={{ fontFamily: 'DM Serif Display, serif' }}>
              How It Works
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-6 w-full">
            {[
              {
                step: '01',
                title: 'Set your role',
                body: "Enter the job title and experience level you're targeting. Sage tailors every question to your specific context.",
              },
              {
                step: '02',
                title: 'Speak your answers',
                body: 'Sage listens, adapts questions based on what you say, and follows up like a real interviewer — no typing required.',
              },
              {
                step: '03',
                title: 'Get your report',
                body: 'Receive a full scored evaluation with feedback on every answer so you know exactly what to improve.',
              },
            ].map(({ step, title, body }, i) => (
              <FadeInSection key={step} delay={i * 120} className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--accent)] tracking-widest">{step}</span>
                  <div className="flex-1 h-px bg-[var(--border)]" />
                </div>
                <h3 className="text-base text-[var(--text-primary)]"
                  style={{ fontFamily: 'DM Serif Display, serif' }}>
                  {title}
                </h3>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{body}</p>
              </FadeInSection>
            ))}
          </div>
        </FadeInSection>
      </section>

      {/* ── WHAT MAKES SAGE DIFFERENT ── */}
      <section className="px-6 py-24 flex flex-col items-center border-t border-[var(--border)]"
        style={{ background: 'var(--surface)' }}>
        <FadeInSection className="flex flex-col items-center gap-12 w-full max-w-4xl">
          <div className="text-center">
            <p className="text-xs tracking-widest uppercase text-[var(--accent)] mb-3">Why Sage</p>
            <h2 className="text-2xl sm:text-3xl text-[var(--text-primary)]"
              style={{ fontFamily: 'DM Serif Display, serif' }}>
              What Makes Sage Different
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
            {[
              {
                title: 'Truly Adaptive',
                body: "Sage doesn't just read from a question bank. It listens to your answers and decides what to ask next.",
                icon: '◈',
              },
              {
                title: 'Voice First',
                body: "Practice the way you'll actually interview — out loud. Not by typing into a chat box.",
                icon: '◎',
              },
              {
                title: 'Real Feedback',
                body: 'Every answer is scored 0–10 with detailed reasoning, not just generic tips.',
                icon: '◐',
              },
            ].map(({ title, body, icon }, i) => (
              <FadeInSection key={title} delay={i * 120}
                className="flex flex-col gap-4 p-6 border border-[var(--border)] rounded-xl"
                style={{ background: 'var(--bg)' } as React.CSSProperties}>
                <span className="text-[var(--accent)] text-lg">{icon}</span>
                <h3 className="text-base text-[var(--text-primary)]"
                  style={{ fontFamily: 'DM Serif Display, serif' }}>
                  {title}
                </h3>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{body}</p>
              </FadeInSection>
            ))}
          </div>
        </FadeInSection>
      </section>

      {/* ── SOCIAL PROOF ── */}
      <section className="px-6 py-24 flex flex-col items-center border-t border-[var(--border)]">
        <FadeInSection className="flex flex-col items-center gap-6 max-w-xl text-center">
          <span className="text-3xl text-[var(--accent)] opacity-40"
            style={{ fontFamily: 'DM Serif Display, serif' }}>"</span>
          <blockquote className="text-base sm:text-lg text-[var(--text-primary)] leading-relaxed"
            style={{ fontFamily: 'DM Serif Display, serif' }}>
            I used Sage the night before my interview and it caught weaknesses in my answers
            I didn't even realize I had.
          </blockquote>
          <p className="text-xs text-[var(--text-secondary)] tracking-wide">
            — Software Developer, currently job searching
          </p>
        </FadeInSection>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="px-6 py-24 flex flex-col items-center border-t border-[var(--border)]"
        style={{ background: 'var(--surface)' }}>
        <FadeInSection className="flex flex-col items-center gap-6 max-w-xl text-center">
          <h2 className="text-2xl sm:text-3xl text-[var(--text-primary)]"
            style={{ fontFamily: 'DM Serif Display, serif' }}>
            Ready to stop guessing<br className="hidden sm:block" /> and start practicing?
          </h2>
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed max-w-sm">
            One session is enough to surface what you need to work on. No signup, no credit card.
          </p>
          <button
            onClick={onCtaClick}
            className="px-8 py-3 rounded-lg text-sm tracking-widest uppercase transition-all duration-300 hover:opacity-90"
            style={{ background: 'var(--accent)', color: 'var(--bg)' }}>
            Start Your Free Session
          </button>
        </FadeInSection>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-[var(--border)] px-6 py-8 flex items-center justify-between">
        <span className="text-sm text-[var(--text-muted)]"
          style={{ fontFamily: 'DM Serif Display, serif' }}>
          Sage
        </span>
        <span className="text-xs text-[var(--text-muted)]">AI-powered interview practice</span>
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
'use client';

import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, UserButton, SignIn } from '@clerk/nextjs';
import { useSpeech } from '@/lib/hooks/useSpeech';
import { useRealtimeSession } from '@/lib/hooks/useRealtimeSession';
import { downloadReport } from '@/lib/exportReport';
import { SaveStatusToast } from '@/components/interview/SaveStatusToast';
import type {
  ExaminerState,
  FinalEvaluation,
  ExchangeRecord,
  TopicArea,
  InterviewType,
  ExperienceLevel,
} from '@/lib/agent/types';

type AppPhase = 'landing' | 'loading' | 'session' | 'complete';

// ─────────────────────────────────────────────
// SUBCOMPONENTS
// ─────────────────────────────────────────────

function LiveOrb({ status, volume = 0 }: { status: string; volume?: number }) {
  const isIdle = status === 'idle';
  const isSpeaking = status === 'speaking';
  const isListening = status === 'listening';
  const isProcessing = status === 'processing';

  // Volume-reactive bar heights for listening state (0-1 input → 12-32px range)
  const barBase = 12;
  const barRange = 20;
  const bars = Array.from({ length: 5 });

  // Core orb colours per state
  const orbBorder = isSpeaking
    ? 'rgba(200,184,154,0.7)'
    : isListening
    ? 'rgba(16,185,129,0.7)'
    : isProcessing
    ? 'rgba(245,158,11,0.7)'
    : 'rgba(124,58,237,0.55)';

  const orbGlow = isSpeaking
    ? 'rgba(200,184,154,0.12)'
    : isListening
    ? 'rgba(16,185,129,0.10)'
    : isProcessing
    ? 'rgba(245,158,11,0.10)'
    : 'rgba(124,58,237,0.08)';

  return (
    <div className="relative flex items-center justify-center w-36 h-36">
      {/* Ring waves — speaking (tan) or listening (emerald) */}
      {(isSpeaking || isListening) && [0, 1, 2].map((i) => (
        <div
          key={i}
          className="absolute rounded-full border"
          style={{
            inset: `${isListening ? 20 : 28}px`,
            borderColor: isListening ? 'rgba(16,185,129,0.4)' : 'rgba(200,184,154,0.35)',
            animation: `orb-ring-wave ${isListening ? 1.6 : 2.2}s ease-out ${i * (isListening ? 0.45 : 0.6)}s infinite`,
          }}
        />
      ))}

      {/* Processing arc — rotating conic gradient */}
      {isProcessing && (
        <div
          className="absolute rounded-full"
          style={{
            inset: '16px',
            background: 'conic-gradient(from 0deg, rgba(245,158,11,0.8) 0deg, transparent 120deg)',
            animation: 'orb-rotate 1.4s linear infinite',
          }}
        />
      )}

      {/* Core orb */}
      <div
        className="relative z-10 flex items-center justify-center w-20 h-20 rounded-full border transition-all duration-500"
        style={{
          borderColor: orbBorder,
          background: `radial-gradient(circle at 38% 36%, ${orbGlow}, transparent 68%)`,
          boxShadow: `0 0 28px ${orbGlow}, 0 0 8px ${orbGlow}`,
          animation: isIdle ? 'orb-breathe 3.6s ease-in-out infinite' : 'none',
        }}
      >
        {isSpeaking && (
          <div className="flex items-center gap-[3px]">
            {bars.map((_, i) => (
              <div key={i} className="w-[3px] rounded-full"
                style={{
                  height: '20px',
                  backgroundColor: 'var(--accent)',
                  animation: `wave 0.9s ease-in-out ${i * 0.12}s infinite`,
                }} />
            ))}
          </div>
        )}

        {isListening && (
          <div className="flex items-center gap-[3px]">
            {bars.map((_, i) => {
              const offset = Math.abs(i - 2) / 2; // taper edges
              const heightPx = barBase + (volume * barRange * (1 - offset * 0.5));
              return (
                <div key={i} className="w-[3px] rounded-full transition-all duration-75"
                  style={{
                    height: `${heightPx}px`,
                    backgroundColor: '#10b981',
                    animation: `wave ${0.7 + offset * 0.3}s ease-in-out ${i * 0.1}s infinite`,
                  }} />
              );
            })}
          </div>
        )}

        {isProcessing && (
          <div className="flex gap-1.5 items-center">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-1.5 h-1.5 rounded-full"
                style={{
                  backgroundColor: '#f59e0b',
                  animation: `orb-bounce 0.8s ease-in-out ${i * 0.18}s infinite`,
                }} />
            ))}
          </div>
        )}

        {isIdle && (
          <div className="w-2.5 h-2.5 rounded-full"
            style={{ background: 'rgba(124,58,237,0.7)', boxShadow: '0 0 10px rgba(124,58,237,0.5)' }} />
        )}
      </div>
    </div>
  );
}

function StatusLabel({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    idle: { label: 'ready', color: 'var(--text-muted)' },
    speaking: { label: 'sage is speaking...', color: 'var(--accent)' },
    listening: { label: 'listening...', color: '#10b981' },
    processing: { label: 'thinking...', color: '#f59e0b' },
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
            {area.covered && area.score !== null && (
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

// ── Animated circular score ring ─────────────────────────────────────────────
function ScoreRing({ score }: { score: number }) {
  const R = 22;
  const SIZE = 56;
  const STROKE = 3.5;
  const circumference = 2 * Math.PI * R;
  const color = score >= 7 ? '#10b981' : score >= 4 ? '#f59e0b' : '#c0504a';

  const [displayed, setDisplayed] = useState(0);
  const [dashOffset, setDashOffset] = useState(circumference);

  useEffect(() => {
    const duration = 1200;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplayed(Math.round(eased * score));
      setDashOffset(circumference - circumference * (eased * score) / 10);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [score, circumference]);

  return (
    <div className="relative flex-shrink-0" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
          stroke="rgba(255,255,255,0.06)" strokeWidth={STROKE} />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
          stroke={color} strokeWidth={STROKE}
          strokeDasharray={circumference} strokeDashoffset={dashOffset}
          strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-medium leading-none" style={{ color }}>{displayed}</span>
        <span className="text-[9px] leading-none mt-0.5" style={{ color: 'var(--text-muted)' }}>/10</span>
      </div>
    </div>
  );
}

// ── Animated readiness tick-up ────────────────────────────────────────────────
function AnimatedReadiness({ rating }: { rating: string }) {
  const match = rating.match(/\d+/);
  const target = match ? parseInt(match[0], 10) : null;
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (target === null) return;
    const duration = 1500;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setCount(Math.round(eased * target));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target]);

  const display = target !== null ? rating.replace(/\d+/, String(count)) : rating;
  return (
    <div className="text-5xl font-light text-[var(--accent)] mb-1"
      style={{ fontFamily: 'DM Serif Display, serif' }}>
      {display}
    </div>
  );
}

function EvaluationScreen({ evaluation, role, exchanges, onRestart }: {
  evaluation: FinalEvaluation;
  role: string;
  exchanges: ExchangeRecord[];
  onRestart: () => void;
}) {
  // ── Mount flag drives all stagger animations ──────────────────────────────
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // ── Early-exit guard ────────────────────────────────────────────────────
  // Fires when the session was cut short before meaningful data was collected.
  // Condition: total transcript chars < 1000  OR  fewer than 5 assistant turns.
  // Either threshold alone is enough — we don't require both.
  const totalTranscriptChars = exchanges.reduce(
    (sum, e) => sum + e.question.length + e.answer.length,
    0,
  );
  const assistantMessageCount = exchanges.length; // each exchange = one Q&A turn
  const isEarlyExit = totalTranscriptChars < 1000 || assistantMessageCount < 5;

  // ── Short-session guard (score-based, secondary) ────────────────────────
  // Fires when the score is low AND answers were thin — catches cases where the
  // user spoke enough turns but said very little in each.
  const totalAnswerWords = exchanges.reduce(
    (sum, e) => sum + e.answer.trim().split(/\s+/).filter(Boolean).length,
    0,
  );
  const isShortSession = !isEarlyExit && evaluation.overallScore < 5 && totalAnswerWords < 100;

  // Either flag suppresses Communication Gaps in favour of Potential
  const suppressGaps = isEarlyExit || isShortSession;

  return (
    <div className="w-full max-w-lg animate-fade-in flex flex-col gap-6 py-12">
      {/* Header */}
      <div className="text-center">
        <p className="text-xs text-[var(--text-secondary)] tracking-widest uppercase mb-2">
          Interview Assessment — {role}
        </p>

        {isEarlyExit ? (
          /* ── Session Summary badge: early exit ─────────────────────── */
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm tracking-wide"
            style={{
              borderColor: 'var(--yellow)',
              color: 'var(--yellow)',
              background: 'rgba(212,168,67,0.08)',
            }}>
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: 'var(--yellow)' }} />
            Session Summary
          </div>
        ) : isShortSession ? (
          /* ── Session Incomplete badge: low score + thin answers ─────── */
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm tracking-wide"
            style={{
              borderColor: 'var(--yellow)',
              color: 'var(--yellow)',
              background: 'rgba(212,168,67,0.08)',
            }}>
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: 'var(--yellow)' }} />
            Session Incomplete
          </div>
        ) : (
          /* ── Full readiness percentage — animated tick-up ───────────── */
          <AnimatedReadiness rating={evaluation.readinessRating} />
        )}

        {isEarlyExit ? (
          /* Early-exit message replaces the LLM summary */
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed mt-3">
            The session ended prematurely. For a full score and deep-dive feedback,
            please complete at least 5–10 minutes of the interview.
          </p>
        ) : (
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed mt-3">
            {evaluation.summary}
          </p>
        )}
      </div>

      {/* Area scores — shown for all session types */}
      <div className="border border-[var(--border)] rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
          <p className="text-xs text-[var(--text-secondary)] tracking-widest uppercase">
            Area Breakdown
          </p>
        </div>
        {evaluation.areaScores.map((area, i) => (
          <div key={i} className="px-4 py-4 border-b border-[var(--border)] last:border-0 flex items-start gap-4">
            <ScoreRing score={area.score} />
            <div className="flex-1 flex flex-col gap-1 pt-1">
              <span className="text-sm text-[var(--text-primary)]">{area.areaName}</span>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{area.feedback}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Potential — replaces Communication Gaps for short / early-exit sessions */}
      {suppressGaps && evaluation.strengths.length > 0 && (
        <div className="border rounded-lg p-4"
          style={{ borderColor: 'var(--yellow)', background: 'rgba(212,168,67,0.05)' }}>
          <p className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--yellow)' }}>
            Potential
          </p>
          <p className="text-xs text-[var(--text-secondary)] mb-3 leading-relaxed">
            The session was too brief for a full assessment, but here's what stood out:
          </p>
          <ul className="flex flex-col gap-2">
            {evaluation.strengths.map((s, i) => (
              <li key={i} className="text-xs text-[var(--text-secondary)] pl-3 py-1 leading-relaxed"
                style={{
                  borderLeft: '2px solid #10b981',
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? 'translateY(0)' : 'translateY(6px)',
                  transition: `opacity 0.4s ease ${i * 100}ms, transform 0.4s ease ${i * 100}ms`,
                }}>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* What You Did Well — full sessions only */}
      {!suppressGaps && evaluation.strengths.length > 0 && (
        <div className="border border-[var(--border)] rounded-lg p-4">
          <p className="text-xs text-[var(--green)] tracking-widest uppercase mb-3">
            What You Did Well
          </p>
          <ul className="flex flex-col gap-2">
            {evaluation.strengths.map((s, i) => (
              <li key={i} className="text-xs text-[var(--text-secondary)] pl-3 py-1 leading-relaxed"
                style={{
                  borderLeft: '2px solid #10b981',
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? 'translateY(0)' : 'translateY(6px)',
                  transition: `opacity 0.4s ease ${i * 100}ms, transform 0.4s ease ${i * 100}ms`,
                }}>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Communication Gaps — full sessions only */}
      {!suppressGaps && evaluation.weakMoments?.length > 0 && (
        <div className="border border-[var(--border)] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
            <p className="text-xs text-[var(--red)] tracking-widest uppercase">
              Communication Gaps
            </p>
          </div>
          {evaluation.weakMoments.map((moment, i) => (
            <div key={i} className="py-4 border-b border-[var(--border)] last:border-0 flex flex-col gap-2"
              style={{
                paddingLeft: '16px',
                borderLeft: '2px solid #f59e0b',
                marginLeft: '16px',
                marginRight: '16px',
                opacity: mounted ? 1 : 0,
                transform: mounted ? 'translateY(0)' : 'translateY(6px)',
                transition: `opacity 0.4s ease ${i * 100}ms, transform 0.4s ease ${i * 100}ms`,
              }}>
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

      {/* Recommendation — always shown */}
      <div className="border border-[var(--border-bright)] rounded-lg p-4 bg-[var(--glow)]">
        <p className="text-xs text-[var(--accent)] tracking-widest uppercase mb-2">
          Top Priority
        </p>
        <p className="text-sm text-[var(--text-primary)] leading-relaxed">
          {evaluation.recommendation}
        </p>
      </div>

      {/* Download — always available, independent of whether the server-side save succeeded */}
      <button onClick={() => downloadReport({ role, evaluation, exchanges })}
        className="w-full py-3 border border-[var(--border)] rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-all duration-300 tracking-widest uppercase">
        Download Report
      </button>

      {/* Restart */}
      <button onClick={onRestart}
        className="w-full py-3 border border-[var(--border-bright)] rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-all duration-300 tracking-widest uppercase">
        Start New Session
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// MOBILE READY SCREEN
// Only shown on mobile between form submission
// and the actual Vapi session start.
// ─────────────────────────────────────────────
function ReadyScreen({ role, experienceLevel, interviewType, onBegin }: {
  role: string;
  experienceLevel: ExperienceLevel;
  interviewType: InterviewType;
  onBegin: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6"
      style={{ background: 'var(--bg)' }}
    >
      {/* Pulse animation injected inline — no globals.css change needed */}
      <style>{`
        @keyframes readyGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(200,184,154,0.40); }
          55%       { box-shadow: 0 0 0 16px rgba(200,184,154,0); }
        }
        .ready-btn-pulse { animation: readyGlow 2.2s ease-in-out infinite; }
      `}</style>

      {/* Interview details */}
      <div className="text-center mb-10 animate-fade-in">
        <p className="text-xs text-[var(--text-secondary)] tracking-widest uppercase mb-5">
          Your Interview
        </p>
        <p
          className="text-3xl text-[var(--text-primary)] mb-2"
          style={{ fontFamily: 'DM Serif Display, serif' }}
        >
          {role}
        </p>
        <p className="text-sm text-[var(--text-secondary)] capitalize">
          {experienceLevel}&nbsp;·&nbsp;{interviewType}
        </p>
      </div>

      {/* Breathing moment */}
      <div className="text-center mb-12 animate-fade-in">
        <p
          className="text-xl text-[var(--text-secondary)] leading-relaxed"
          style={{ fontFamily: 'DM Serif Display, serif' }}
        >
          Take a breath. You've got this.
        </p>
      </div>

      {/* CTA */}
      <div className="w-full max-w-sm flex flex-col items-center gap-4 animate-fade-in">
        <button
          onClick={onBegin}
          className="ready-btn-pulse w-full py-5 rounded-xl text-sm tracking-widest uppercase font-medium transition-opacity active:opacity-80"
          style={{ background: 'var(--accent)', color: 'var(--bg)' }}
        >
          I'm Ready — Begin Interview
        </button>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Make sure your volume is turned up
        </p>
      </div>
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
  onStart: (data: { resumePdfBase64: string; jobDescription: string; roundType: 'screening' | 'technical' | 'final' }) => void;
  onClose: () => void;
  unlockAudio: () => void;
  isSupported: boolean;
  error: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jdRef = useRef('');

  const [resumeBase64, setResumeBase64] = useState('');
  const [resumeFileName, setResumeFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const [jdHasValue, setJdHasValue] = useState(false);
  const [roundType, setRoundType] = useState<'screening' | 'technical' | 'final'>('screening');

  useEffect(() => {
    if (!isVisible) {
      setResumeBase64('');
      setResumeFileName('');
      setFileError('');
      jdRef.current = '';
      setJdHasValue(false);
      setRoundType('screening');
    }
  }, [isVisible]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setFileError('Please upload a PDF file.');
      e.target.value = '';
      return;
    }
    setFileError('');
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      setResumeBase64(base64);
      setResumeFileName(file.name);
    };
    reader.onerror = () => {
      setFileError('Could not read that file. Try again.');
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveFile = () => {
    setResumeBase64('');
    setResumeFileName('');
    setFileError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleJdChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    jdRef.current = e.target.value;
    const next = e.target.value.trim().length > 0;
    setJdHasValue(prev => prev === next ? prev : next);
  };

  const canSubmit = resumeBase64.length > 0 && jdHasValue;

  const handleSubmit = () => {
    if (!canSubmit) return;
    unlockAudio();
    onStart({ resumePdfBase64: resumeBase64, jobDescription: jdRef.current.trim(), roundType });
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

        {/* Resume upload */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-[var(--text-secondary)] tracking-widest uppercase">
            Resume (PDF)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
          {resumeBase64 ? (
            <div
              className="flex items-center justify-between border rounded-lg px-4 py-3"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            >
              <span className="text-sm text-[var(--text-primary)] truncate">{resumeFileName}</span>
              <button
                onClick={handleRemoveFile}
                className="ml-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors text-sm leading-none flex-shrink-0">
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full border rounded-lg px-4 py-6 text-sm text-[var(--text-muted)] transition-colors duration-100 text-center"
              style={{ background: 'var(--bg)', borderColor: 'var(--border)', borderStyle: 'dashed' }}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              Click to upload your resume PDF
            </button>
          )}
          {fileError && <p className="text-xs text-[var(--red)]">{fileError}</p>}
        </div>

        {/* Job description */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-[var(--text-secondary)] tracking-widest uppercase">
            Job description
          </label>
          <textarea
            onChange={handleJdChange}
            placeholder="Paste the job description here..."
            rows={5}
            className="w-full border rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none resize-none"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
            onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
            onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
          />
        </div>

        {/* Round type */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-[var(--text-secondary)] tracking-widest uppercase">
            Interview round
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['screening', 'technical', 'final'] as const).map((round) => (
              <button key={round}
                onClick={() => setRoundType(round)}
                className="py-2 rounded-lg text-xs tracking-widest uppercase transition-colors duration-100 border"
                style={{
                  borderColor: roundType === round ? 'var(--accent)' : 'var(--border)',
                  color: roundType === round ? 'var(--accent)' : 'var(--text-muted)',
                  background: roundType === round ? 'var(--glow)' : 'transparent',
                }}>
                {round}
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
          disabled={!canSubmit}
          className="w-full py-3 rounded-lg text-sm tracking-widest uppercase transition-colors duration-100"
          style={{
            background: canSubmit ? 'var(--accent)' : 'var(--surface)',
            color: canSubmit ? 'var(--bg)' : 'var(--text-muted)',
            opacity: canSubmit ? '1' : '0.3',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}>
          Begin Interview
        </button>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────
// DEMO CONTENT — animation loop for hero embed.
// No section wrapper. Pauses when off-screen.
// ─────────────────────────────────────────────

const DEMO_SAGE1 = "Tell me about a time you had to debug a critical issue under pressure.";
const DEMO_USER  = "At my last role, our payment service started failing in production at 2am...";
const DEMO_SAGE2 = "How did you prioritize what to investigate first?";

const T_SAGE1 = 2600;
const T_USER  = 5200;
const T_PROC  = 6200;
const T_SAGE2 = 8000;

function DemoCursor() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: '2px',
        height: '0.88em',
        background: 'currentColor',
        marginLeft: '2px',
        verticalAlign: 'text-bottom',
        borderRadius: '1px',
        animation: 'blink 0.75s ease-in-out infinite',
      }}
    />
  );
}

function DemoContent() {
  const [elapsed, setElapsed] = useState(0);
  const visibleRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { visibleRef.current = entry.isIntersecting; },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (!visibleRef.current) return;
      setElapsed(prev => (prev + 16 >= T_SAGE2 ? 0 : prev + 16));
    }, 16);
    return () => clearInterval(id);
  }, []);

  let orbStatus: string;
  let sage1 = '';
  let userMsg = '';
  let sage2 = '';
  let activeCursor: 'sage1' | 'user' | 'sage2' | null = null;
  let fakeVolume = 0;

  if (elapsed <= T_SAGE1) {
    orbStatus = 'speaking';
    const n = Math.floor((elapsed / T_SAGE1) * DEMO_SAGE1.length);
    sage1 = DEMO_SAGE1.slice(0, n);
    if (n < DEMO_SAGE1.length) activeCursor = 'sage1';
  } else if (elapsed <= T_USER) {
    orbStatus = 'listening';
    sage1 = DEMO_SAGE1;
    const n = Math.floor(((elapsed - T_SAGE1) / (T_USER - T_SAGE1)) * DEMO_USER.length);
    userMsg = DEMO_USER.slice(0, n);
    if (n < DEMO_USER.length) activeCursor = 'user';
    fakeVolume = Math.abs(Math.sin(elapsed / 220)) * 0.65 + 0.2;
  } else if (elapsed <= T_PROC) {
    orbStatus = 'processing';
    sage1 = DEMO_SAGE1;
    userMsg = DEMO_USER;
  } else {
    orbStatus = 'speaking';
    sage1 = DEMO_SAGE1;
    userMsg = DEMO_USER;
    const n = Math.floor(((elapsed - T_PROC) / (T_SAGE2 - T_PROC)) * DEMO_SAGE2.length);
    sage2 = DEMO_SAGE2.slice(0, n);
    if (n < DEMO_SAGE2.length) activeCursor = 'sage2';
  }

  return (
    <div
      ref={containerRef}
      className="w-full rounded-2xl overflow-hidden"
      style={{
        background: '#111111',
        border: '1px solid rgba(200,184,154,0.13)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
      }}
    >
      {/* Chrome bar */}
      <div className="flex items-center gap-2 px-5 py-3.5 border-b"
        style={{ borderColor: 'rgba(200,184,154,0.07)', background: 'rgba(200,184,154,0.02)' }}>
        {[0, 1, 2].map(d => (
          <div key={d} className="w-2.5 h-2.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }} />
        ))}
        <span className="ml-3 text-[11px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.14)' }}>
          sage · interview session
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: '#10b981', boxShadow: '0 0 6px rgba(16,185,129,0.6)', animation: 'pulse-dot 2s ease-in-out infinite' }} />
          <span className="text-[11px]" style={{ color: '#10b981' }}>live</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col sm:flex-row" style={{ minHeight: '280px' }}>
        {/* Orb panel */}
        <div className="flex flex-col items-center justify-center gap-4 px-8 py-8 flex-shrink-0 border-b sm:border-b-0 sm:border-r"
          style={{ minWidth: '180px', borderColor: 'rgba(200,184,154,0.06)', background: 'rgba(0,0,0,0.25)' }}>
          <LiveOrb status={orbStatus} volume={fakeVolume} />
          <StatusLabel status={orbStatus} />
        </div>

        {/* Transcript */}
        <div className="flex-1 flex flex-col gap-4 p-5 sm:p-6 overflow-hidden">
          {sage1 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] tracking-widest uppercase" style={{ color: 'rgba(200,184,154,0.38)' }}>Sage</span>
              <div className="self-start rounded-xl rounded-tl-sm px-4 py-2.5"
                style={{ maxWidth: '90%', background: 'rgba(200,184,154,0.06)', border: '1px solid rgba(200,184,154,0.11)' }}>
                <p className="text-sm leading-relaxed" style={{ color: '#c8b89a' }}>
                  {sage1}{activeCursor === 'sage1' && <DemoCursor />}
                </p>
              </div>
            </div>
          )}
          {userMsg && (
            <div className="flex flex-col gap-1.5 items-end">
              <span className="text-[10px] tracking-widest uppercase" style={{ color: 'rgba(16,185,129,0.38)' }}>You</span>
              <div className="self-end rounded-xl rounded-tr-sm px-4 py-2.5"
                style={{ maxWidth: '90%', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.16)' }}>
                <p className="text-sm leading-relaxed" style={{ color: 'rgba(240,235,227,0.88)' }}>
                  {userMsg}{activeCursor === 'user' && <DemoCursor />}
                </p>
              </div>
            </div>
          )}
          {sage2 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] tracking-widest uppercase" style={{ color: 'rgba(200,184,154,0.38)' }}>Sage</span>
              <div className="self-start rounded-xl rounded-tl-sm px-4 py-2.5"
                style={{ maxWidth: '90%', background: 'rgba(200,184,154,0.06)', border: '1px solid rgba(200,184,154,0.11)' }}>
                <p className="text-sm leading-relaxed" style={{ color: '#c8b89a' }}>
                  {sage2}{activeCursor === 'sage2' && <DemoCursor />}
                </p>
              </div>
            </div>
          )}
          {!sage1 && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.06)' }}>session starting...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// READINESS SCORE REVEAL (Part 3)
// ─────────────────────────────────────────────
function ReadinessSection() {
  const [progress, setProgress] = useState(0);
  const [statsVisible, setStatsVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const triggered = useRef(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !triggered.current) {
          triggered.current = true;
          const start = performance.now();
          const duration = 2000;
          const target = 84;
          const tick = (now: number) => {
            const t = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            setProgress(Math.round(eased * target));
            if (t < 1) requestAnimationFrame(tick);
            else setTimeout(() => setStatsVisible(true), 300);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const R = 78; const SIZE = 180; const STROKE = 7;
  const circumference = 2 * Math.PI * R;
  const dashOffset = circumference - (circumference * progress / 100);

  const cardStyle: React.CSSProperties = {
    background: '#141414',
    border: '1px solid rgba(200,184,154,0.11)',
    borderRadius: '12px',
    padding: '24px',
    opacity: statsVisible ? 1 : 0,
    transform: statsVisible ? 'translateY(0)' : 'translateY(12px)',
    transition: 'opacity 0.5s ease 0.3s, transform 0.5s ease 0.3s',
  };

  return (
    <section ref={sectionRef} className="px-6 py-24 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-6xl mx-auto flex flex-col items-center gap-16">
        <p className="text-xs tracking-[0.2em] uppercase" style={{ color: '#f59e0b' }}>
          What You Walk Away With
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] items-center gap-10 lg:gap-14 w-full">

          {/* Left card — Topics Covered */}
          <div style={cardStyle} className="order-2 lg:order-1">
            <p className="text-xs tracking-widest uppercase mb-4" style={{ color: 'var(--text-secondary)' }}>
              Topics Covered
            </p>
            <div className="flex flex-col gap-2.5">
              {['Technical Depth', 'Behavioral Judgment', 'Problem Solving'].map(topic => (
                <div key={topic} className="flex items-center gap-3 px-4 py-2.5 rounded-lg"
                  style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.16)' }}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: '#10b981', boxShadow: '0 0 7px rgba(16,185,129,0.5)' }} />
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{topic}</span>
                  <span className="ml-auto text-xs" style={{ color: '#10b981' }}>covered</span>
                </div>
              ))}
            </div>
          </div>

          {/* Center — Large ring */}
          <div className="flex flex-col items-center gap-5 order-1 lg:order-2">
            <div className="relative" style={{ width: SIZE, height: SIZE }}>
              <svg width={SIZE} height={SIZE} style={{ transform: 'rotate(-90deg)' }}>
                <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
                  stroke="rgba(255,255,255,0.05)" strokeWidth={STROKE} />
                <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
                  stroke="#10b981" strokeWidth={STROKE}
                  strokeDasharray={circumference} strokeDashoffset={dashOffset}
                  strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                <span style={{ fontFamily: 'DM Serif Display, serif', fontSize: '3rem', color: '#c8b89a', lineHeight: 1 }}>
                  {progress}%
                </span>
                <span className="text-[11px] tracking-wide" style={{ color: 'var(--text-muted)' }}>readiness</span>
              </div>
            </div>
            <p className="text-sm text-center" style={{ color: 'var(--text-secondary)', maxWidth: '150px' }}>
              Your Interview Readiness Score
            </p>
          </div>

          {/* Right card — Weak Moments */}
          <div style={cardStyle} className="order-3">
            <p className="text-xs tracking-widest uppercase mb-4" style={{ color: 'var(--text-secondary)' }}>
              Weak Moments Identified
            </p>
            <div className="flex flex-col gap-3">
              {[
                { q: '"How do you handle conflict?"', note: '"We usually just figured it out as a team..." — lacked personal ownership' },
                { q: '"Tell me about a failure."', note: '"It kind of worked out in the end..." — no lesson extracted' },
              ].map(({ q, note }, i) => (
                <div key={i} className="flex flex-col gap-1 pl-3 py-1.5" style={{ borderLeft: '2px solid #f59e0b' }}>
                  <p className="text-[11px] font-medium" style={{ color: '#f59e0b' }}>{q}</p>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{note}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────
// QUESTION TICKER (Part 4)
// ─────────────────────────────────────────────
const TICKER_QUESTIONS = [
  'Tell me about a time you failed',
  'Walk me through your system design approach',
  'How do you handle ambiguity?',
  'Describe your biggest technical challenge',
  'Why do you want this role?',
  'How do you prioritize under pressure?',
  'Tell me about a conflict with a teammate',
  "What's your debugging process?",
];

function QuestionTicker() {
  const doubled = [...TICKER_QUESTIONS, ...TICKER_QUESTIONS];
  return (
    <div className="border-t border-b overflow-hidden" style={{ borderColor: 'var(--border)', paddingTop: '48px', paddingBottom: '48px' }}>
      <p className="text-center text-xs tracking-[0.15em] mb-8 px-6" style={{ color: 'var(--text-muted)' }}>
        Sage asks the questions that matter
      </p>
      <div style={{ animation: 'ticker-scroll 52s linear infinite', width: 'max-content', display: 'flex', alignItems: 'center' }}>
        {doubled.map((q, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>
            <span style={{
              padding: '10px 22px',
              borderRadius: '999px',
              fontSize: '13px',
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap',
              background: '#1a1a1a',
              border: '1px solid rgba(200,184,154,0.09)',
              color: '#c8b89a',
              flexShrink: 0,
            }}>{q}</span>
            <span style={{ margin: '0 16px', width: '5px', height: '5px', borderRadius: '50%', background: '#f59e0b', opacity: 0.55, flexShrink: 0 }} />
          </span>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MOCK SCORE RING — used in report preview only
// ─────────────────────────────────────────────
function MockScoreRing({ label, target }: { label: string; target: number }) {
  const [progress, setProgress] = useState(0);
  const triggered = useRef(false);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ringRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !triggered.current) {
          triggered.current = true;
          const start = performance.now();
          const duration = 1200;
          const tick = (now: number) => {
            const t = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            setProgress(Math.round(eased * target));
            if (t < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.5 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [target]);

  const R = 36; const SIZE = 88; const STROKE = 4.5;
  const circ = 2 * Math.PI * R;
  const offset = circ - (circ * progress / 100);

  return (
    <div ref={ringRef} className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={STROKE} />
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#10b981" strokeWidth={STROKE}
            strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span style={{ fontSize: '15px', fontWeight: 500, color: '#c8b89a' }}>{progress}%</span>
        </div>
      </div>
      <p className="text-xs tracking-wide text-center" style={{ color: 'var(--text-secondary)' }}>{label}</p>
    </div>
  );
}

// ─────────────────────────────────────────────
// MOCK EVALUATION REPORT PREVIEW (Part 5)
// Hardcoded — not the real EvaluationScreen.
// ─────────────────────────────────────────────
const MOCK_REPORT_SCORES = [
  { label: 'Technical', target: 78 },
  { label: 'Behavioral', target: 85 },
  { label: 'Communication', target: 80 },
];
const MOCK_REPORT_STRENGTHS = [
  'Clearly articulated system design trade-offs with specific examples',
  'Demonstrated self-awareness when reflecting on past failures',
  'Quantified impact — mentioned concrete metrics and outcomes',
];
const MOCK_REPORT_GAPS = [
  '"We kind of figured it out together..." — avoided personal ownership',
  '"It eventually worked out..." — no lesson or process change extracted',
];

function MockReportSection() {
  const [listsVisible, setListsVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const triggered = useRef(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !triggered.current) {
          triggered.current = true;
          setTimeout(() => setListsVisible(true), 1300);
        }
      },
      { threshold: 0.2 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="px-6 py-24 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-4xl mx-auto flex flex-col items-center gap-12">
        <p className="text-xs tracking-[0.2em] uppercase" style={{ color: '#f59e0b' }}>See Your Full Report</p>

        <div className="w-full rounded-2xl p-8 sm:p-10 flex flex-col gap-8"
          style={{ background: '#141414', border: '1px solid rgba(200,184,154,0.11)' }}>

          {/* Score rings */}
          <div className="flex items-start justify-center gap-8 sm:gap-14 flex-wrap">
            {MOCK_REPORT_SCORES.map(s => (
              <MockScoreRing key={s.label} label={s.label} target={s.target} />
            ))}
          </div>

          <div className="border-t" style={{ borderColor: 'rgba(200,184,154,0.07)' }} />

          {/* Two columns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="flex flex-col gap-3">
              <p className="text-xs tracking-widest uppercase mb-1" style={{ color: '#10b981' }}>Strengths</p>
              {MOCK_REPORT_STRENGTHS.map((s, i) => (
                <p key={i} className="text-xs leading-relaxed pl-3 py-1"
                  style={{
                    borderLeft: '2px solid #10b981',
                    color: 'var(--text-secondary)',
                    opacity: listsVisible ? 1 : 0,
                    transform: listsVisible ? 'translateY(0)' : 'translateY(6px)',
                    transition: `opacity 0.4s ease ${i * 100}ms, transform 0.4s ease ${i * 100}ms`,
                  }}>{s}</p>
              ))}
            </div>
            <div className="flex flex-col gap-3">
              <p className="text-xs tracking-widest uppercase mb-1" style={{ color: '#f59e0b' }}>Weak Moments</p>
              {MOCK_REPORT_GAPS.map((g, i) => (
                <p key={i} className="text-xs leading-relaxed pl-3 py-1 italic"
                  style={{
                    borderLeft: '2px solid #f59e0b',
                    color: 'var(--text-muted)',
                    opacity: listsVisible ? 1 : 0,
                    transform: listsVisible ? 'translateY(0)' : 'translateY(6px)',
                    transition: `opacity 0.4s ease ${(i + MOCK_REPORT_STRENGTHS.length) * 100}ms, transform 0.4s ease ${(i + MOCK_REPORT_STRENGTHS.length) * 100}ms`,
                  }}>{g}</p>
              ))}
            </div>
          </div>

          <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
            Generated after every session. Yours will reflect your actual answers.
          </p>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────
// AUTH GATE — fullscreen overlay shown when a
// returning unauthenticated user tries to start
// a second session
// ─────────────────────────────────────────────
function AuthGate({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,10,10,0.97)',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2.5rem',
        padding: '1.5rem',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Violet radial glow */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -60%)',
          width: '600px',
          height: '600px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '1.5rem',
          right: '1.5rem',
          background: 'transparent',
          border: 'none',
          color: '#3d3b37',
          fontSize: '1.25rem',
          cursor: 'pointer',
          lineHeight: 1,
          padding: '0.25rem',
          transition: 'color 0.2s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#6b6863'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#3d3b37'; }}
        aria-label="Close"
      >
        ✕
      </button>

      {/* Wordmark */}
      <span
        style={{
          fontFamily: 'DM Serif Display, serif',
          fontSize: '1.5rem',
          color: '#c8b89a',
          position: 'relative',
          zIndex: 1,
        }}
      >
        Sage
      </span>

      {/* Headline */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          maxWidth: '28rem',
        }}
      >
        <h2
          style={{
            fontFamily: 'DM Serif Display, serif',
            fontSize: 'clamp(1.5rem, 4vw, 2rem)',
            lineHeight: 1.2,
            color: '#f0ebe3',
            margin: 0,
          }}
        >
          Sign in to{' '}
          <span style={{ color: '#c8b89a' }}>
            start your interview.
          </span>
        </h2>
        <p style={{ fontSize: '0.8rem', color: '#6b6863', margin: 0, lineHeight: 1.6 }}>
          It takes a few seconds and lets us save your report.
        </p>
      </div>

      {/* Clerk sign-in */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <SignIn
          routing="hash"
          appearance={{
            variables: {
              colorBackground: '#141414',
              colorInputBackground: '#1a1a1a',
              colorInputText: '#f0ebe3',
              colorText: '#f0ebe3',
              colorTextSecondary: '#9a9a9a',
              colorPrimary: '#c8b89a',
              colorNeutral: '#c8b89a',
              borderRadius: '8px',
              fontFamily: 'DM Mono, monospace',
            },
          }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// LANDING PAGE — memoized so it never re-renders
// while the form modal is open or being typed into
// ─────────────────────────────────────────────
const LandingPage = memo(function LandingPage({ onCtaClick }: { onCtaClick: () => void }) {
  const { isSignedIn } = useAuth();
  const router = useRouter();

  const handleCta = () => {
    onCtaClick(); // Auth gate is checked inside the form submit, not here
  };

  return (
    <>
      {/* ── NAV ── */}
      <nav
        className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-6 sm:px-10 py-5 border-b"
        style={{ background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(20px)', borderColor: '#1c1c1c' }}
      >
        <span className="text-2xl tracking-tight" style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--accent)' }}>
          Sage
        </span>
        {isSignedIn ? (
          <UserButton afterSignOutUrl="/" />
        ) : (
          <button
            onClick={() => router.push('/sign-in')}
            className="text-xs tracking-widest uppercase px-4 py-2 rounded-lg border transition-all duration-300"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.75'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
          >
            Sign In
          </button>
        )}
      </nav>

      {/* ── HERO — two-column ── */}
      <section className="relative min-h-screen flex items-center px-6 sm:px-10 lg:px-16 pt-24 pb-16 overflow-hidden">
        <div className="w-full max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-10 lg:gap-16">

          {/* Left: headline + subtitle + desktop CTA */}
          <div className="flex flex-col gap-7 lg:flex-1 z-10 order-1">
            {/* Badge */}
            <div
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border text-xs tracking-widest uppercase self-start"
              style={{ background: 'rgba(245,158,11,0.07)', borderColor: 'rgba(245,158,11,0.25)', color: '#f59e0b' }}
            >
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse-dot"
                style={{ background: '#f59e0b', boxShadow: '0 0 8px rgba(245,158,11,0.55)' }} />
              AI Interview Coach
            </div>

            {/* Headline */}
            <h1
              className="text-4xl sm:text-5xl lg:text-6xl xl:text-[4.2rem] leading-[1.06] tracking-tight"
              style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--text-primary)' }}
            >
              The Interview Coach
              <br />
              <span className="relative inline-block" style={{ color: 'var(--accent)' }}>
                That Actually Listens.
                <svg
                  className="absolute left-0 w-full pointer-events-none"
                  style={{ bottom: '-8px', height: '12px' }}
                  viewBox="0 0 520 12"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path
                    d="M0,9 C45,3 100,11 170,7 C240,3 295,10 360,6 C425,2 470,9 520,6"
                    stroke="var(--accent)"
                    strokeWidth="3"
                    fill="none"
                    strokeLinecap="round"
                    opacity="0.7"
                  />
                </svg>
              </span>
            </h1>

            {/* Subtitle */}
            <p className="text-sm sm:text-base leading-relaxed max-w-md" style={{ color: 'var(--text-secondary)' }}>
              Sage conducts real adaptive voice interviews, follows up on your answers, and
              delivers a scored evaluation — just like a real interviewer.
            </p>

            {/* Desktop CTA */}
            <div className="hidden lg:flex items-center gap-5">
              <button
                onClick={handleCta}
                className="btn-shimmer px-8 py-3.5 rounded-lg text-sm tracking-widest uppercase font-medium"
                style={{ background: '#10b981', color: '#0a0a0a' }}
              >
                Start Practicing Free
              </button>
            </div>
          </div>

          {/* Right: demo */}
          <div className="w-full lg:flex-1 z-10 order-2">
            <DemoContent />
          </div>

          {/* Mobile CTA — shown below demo */}
          <div className="flex lg:hidden flex-col items-center gap-3 w-full z-10 order-3">
            <button
              onClick={handleCta}
              className="btn-shimmer w-full max-w-sm py-4 rounded-lg text-sm tracking-widest uppercase font-medium"
              style={{ background: '#10b981', color: '#0a0a0a' }}
            >
              Start Practicing Free
            </button>
          </div>
        </div>
      </section>

      {/* ── READINESS SCORE REVEAL ── */}
      <ReadinessSection />

      {/* ── QUESTION TICKER ── */}
      <QuestionTicker />

      {/* ── HOW IT WORKS ── */}
      <section className="px-6 py-24 flex flex-col items-center border-t" style={{ borderColor: 'var(--border)' }}>
        <FadeInSection className="flex flex-col items-center gap-14 w-full max-w-5xl">
          <div className="text-center">
            <p className="text-xs tracking-widest uppercase mb-3" style={{ color: '#f59e0b' }}>Process</p>
            <h2 className="text-3xl sm:text-4xl" style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--text-primary)' }}>
              How It Works
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 w-full">
            {[
              { step: '01', title: 'Choose your role and level', body: "Pick the job title and experience level you're targeting. Every question is tailored to your exact context." },
              { step: '02', title: 'Speak your answers out loud', body: 'Sage listens, adapts in real time, and follows up like a real interviewer — no scripted question lists.' },
              { step: '03', title: 'Get your weak spots identified', body: 'Receive a full scored evaluation with exact feedback on what fell short and how to fix it.' },
            ].map(({ step, title, body }, i) => (
              <FadeInSection key={step} delay={i * 100}>
                <div className="relative overflow-hidden rounded-xl p-7 h-full flex flex-col gap-5 border-t border-r border-b"
                  style={{
                    background: '#141414',
                    borderTopColor: 'var(--border)',
                    borderRightColor: 'var(--border)',
                    borderBottomColor: 'var(--border)',
                    borderLeft: '2px solid rgba(16,185,129,0.4)',
                  }}>
                  <span className="absolute -top-3 right-4 select-none pointer-events-none leading-none"
                    style={{ fontFamily: 'DM Serif Display, serif', fontSize: '7rem', color: 'var(--accent)', opacity: 0.04 }}
                    aria-hidden="true">{step}</span>
                  <span className="text-xs tracking-widest" style={{ color: '#f59e0b' }}>{step}</span>
                  <h3 className="text-base leading-snug" style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--text-primary)' }}>{title}</h3>
                  <p className="text-xs leading-relaxed mt-auto" style={{ color: 'var(--text-secondary)' }}>{body}</p>
                </div>
              </FadeInSection>
            ))}
          </div>
        </FadeInSection>
      </section>

      {/* ── EVALUATION REPORT PREVIEW ── */}
      <MockReportSection />

      {/* ── WHAT MAKES SAGE DIFFERENT ── */}
      <section className="px-6 py-24 flex flex-col items-center border-t" style={{ borderColor: 'var(--border)', background: '#111111' }}>
        <FadeInSection className="flex flex-col items-center gap-14 w-full max-w-5xl">
          <div className="text-center">
            <p className="text-xs tracking-widest uppercase mb-3" style={{ color: 'var(--accent)' }}>Why Sage</p>
            <h2 className="text-3xl sm:text-4xl" style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--text-primary)' }}>
              What Makes Sage Different
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 w-full">
            {[
              { title: 'Truly Adaptive', body: "Sage doesn't read from a question bank. It listens to what you actually say and decides what to probe next.", icon: '✦' },
              { title: 'Voice First', body: "Practice the way you'll actually interview — speaking out loud, not typing into a chat window.", icon: '◉' },
              { title: 'Real Feedback', body: 'Every answer is scored with specific reasoning. No generic advice. No filler.', icon: '◆' },
            ].map(({ title, body, icon }, i) => (
              <FadeInSection key={title} delay={i * 100}>
                <div className="glass-card rounded-xl p-7 flex flex-col gap-5 h-full">
                  <span className="text-3xl" style={{ color: 'var(--accent)' }}>{icon}</span>
                  <h3 className="text-base leading-snug" style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--text-primary)' }}>{title}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{body}</p>
                </div>
              </FadeInSection>
            ))}
          </div>
        </FadeInSection>
      </section>

      {/* ── EARLY ACCESS ── */}
      <section className="px-6 py-24 flex flex-col items-center border-t" style={{ borderColor: 'var(--border)' }}>
        <FadeInSection className="w-full max-w-lg">
          <div className="rounded-2xl p-8 flex flex-col gap-5"
            style={{ background: '#141414', border: '1px solid rgba(200,184,154,0.15)' }}>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
              <span className="text-xs tracking-widest uppercase" style={{ color: 'var(--accent)' }}>Early Access</span>
            </div>
            <h3 className="text-2xl sm:text-3xl leading-snug"
              style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--text-primary)' }}>
              Sage is new. Be one of the first to use it.
            </h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              We're actively improving Sage based on real sessions. Your feedback directly shapes
              what gets built next — new interview types, deeper feedback, and industry-specific question sets.
            </p>
            <p className="text-xs leading-relaxed pt-2 border-t"
              style={{ color: 'var(--text-muted)', borderColor: 'rgba(200,184,154,0.09)' }}>
              No account required. Just start a session and tell us what you think.
            </p>
          </div>
        </FadeInSection>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="relative px-6 py-24 flex flex-col items-center border-t overflow-hidden"
        style={{ borderColor: 'var(--border)', background: '#111111' }}>
        <FadeInSection className="relative z-10 flex flex-col items-center gap-6 max-w-xl text-center">
          <h2 className="text-3xl sm:text-4xl md:text-5xl leading-tight tracking-tight"
            style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--text-primary)' }}>
            Stop rehearsing.<br />Start performing.
          </h2>
          <p className="text-sm leading-relaxed max-w-sm" style={{ color: 'var(--text-secondary)' }}>
            One session is enough to know exactly what you need to work on. No signup, no credit card.
          </p>
          <button
            onClick={handleCta}
            className="btn-shimmer mt-2 px-9 py-3.5 rounded-lg text-sm tracking-widest uppercase font-medium"
            style={{ background: '#10b981', color: '#0a0a0a' }}
          >
            Start Your Free Session
          </button>
        </FadeInSection>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t px-6 py-8 flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
        <span className="text-sm" style={{ fontFamily: 'DM Serif Display, serif', color: 'var(--text-muted)' }}>Sage</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>AI-powered interview practice</span>
      </footer>
    </>
  );
});

// ─────────────────────────────────────────────
// INTERVIEW PLAN — returned by /api/realtime/initialize
// ─────────────────────────────────────────────

type InterviewPlan = {
  role: string;
  company: string | null;
  seniority: 'junior' | 'mid-level' | 'senior';
  roundType: string;
  areas: { name: string; whyRelevant: string; skillsToTest: string[]; strongAnswerLooksLike: string }[];
  gapsToProbe: { gap: string; howToProbe: string }[];
  strengthsToConfirm: string[];
  topicAreas: { id: string; name: string; covered: boolean; score: number | null; questionCount: number }[];
};

function buildVapiSystemPrompt(plan: InterviewPlan, roundType: 'screening' | 'technical' | 'final'): string {
  const CLOSING_PHRASE = 'That brings us to the end of our interview today. Thank you for your time.';

  const roundDirective: Record<'screening' | 'technical' | 'final', string> = {
    screening:
      `ROUND: SCREENING. Behave like a friendly recruiter doing a first-pass qualification call — warm, brisk, broad. Prioritize breadth and fit over depth. Keep it SHORT: ask 4-5 questions total across the areas, roughly one per area plus a follow-up or two. Do NOT drill deep or demand technical rigor. You are checking motivation, basic competence, and clarity. Override any guideline below that pushes for more questions or deeper probing. Do NOT use end_call until you have asked and received answers for the minimum number of questions specified above AND said the exact phrase "${CLOSING_PHRASE}"`,
    technical:
      `ROUND: TECHNICAL. Stress-test actual technical depth. Push hard on specifics, trade-offs, and production experience. This is the deep round: ask 6-8 questions, at least 2 per area, and follow up relentlessly on vague answers. Set a high bar. The standard guidelines below apply in full. Do NOT use end_call until you have asked and received answers for the minimum number of questions specified above AND said the exact phrase "${CLOSING_PHRASE}"`,
    final:
      `ROUND: FINAL. Assess judgment, ownership, and senior fit — how they work, not just what they know. Go fewer-but-deeper: 4-6 questions total, conversational and probing, heavy on "tell me about a time you owned / decided / disagreed". Confirm whether claimed leadership and impact were really theirs. Favor depth and follow-ups over breadth. Override the per-area question minimums below if depth demands it. Do NOT use end_call until you have asked and received answers for the minimum number of questions specified above AND said the exact phrase "${CLOSING_PHRASE}"`,
  };

  const areasBlock = plan.areas.map((a, i) =>
    `Area ${i + 1}: ${a.name}\n  Why it matters: ${a.whyRelevant}\n  Skills to test: ${a.skillsToTest.join(', ')}\n  A strong answer looks like: ${a.strongAnswerLooksLike}`
  ).join('\n\n');

  const gapsBlock = plan.gapsToProbe.length
    ? plan.gapsToProbe.map(g => `- ${g.gap} (How to probe: ${g.howToProbe})`).join('\n')
    : '- None flagged.';

  const strengthsBlock = plan.strengthsToConfirm.length
    ? plan.strengthsToConfirm.map(s => `- ${s}`).join('\n')
    : '- None flagged.';

  const companyLine = plan.company ? ` at ${plan.company}` : '';

  return `You are Sage, a senior interviewer conducting a ${roundType} interview for a ${plan.seniority} ${plan.role} role${companyLine}.

Assess the candidate across these 3 areas:

${areasBlock}

Resume-vs-role gaps to probe (work these in naturally where relevant):
${gapsBlock}

Resume claims worth confirming:
${strengthsBlock}

FOLLOW-UP PROTOCOL (MANDATORY — overrides every other instruction including ROUND INSTRUCTIONS):

You may NEVER ask a question from a new area immediately after an answer. After every candidate answer, first classify it:

- VAGUE: under 20 words, or no specific reasoning, or cites someone else's opinion ("my friend said", "the team decided"), or names a decision without justifying it.
- SURFACE: correct but generic. States what, not why. No trade-offs, no specifics, no numbers, no consequences.
- SUBSTANTIVE: concrete reasoning, real trade-offs, or lived experience with specifics.

The classification is internal reasoning. NEVER say the words "vague", "surface", or "substantive" out loud. Never announce your classification, never label the answer, never narrate your evaluation process. Everything you output is spoken aloud to the candidate. Classify silently, then act.

Then act:
- VAGUE -> You MUST follow up. Do not accept it. Push on the missing reasoning: "That's your friend's reasoning. What's yours?" or "Walk me through the actual trade-off you were weighing." Keep pushing until they give real reasoning or explicitly say they don't know. "I don't know" ends the thread. A vague answer does not.
- SURFACE -> Ask exactly one follow-up forcing specificity: a concrete example, a number, or what breaks if they had chosen otherwise.
- SUBSTANTIVE -> Acknowledge in three words or fewer, then move on.

Never say "great answer", "good", "perfect", or any praise. An interviewer who accepts weak answers is useless. Your job is to find the floor of what they actually know.

General Guidelines (the ROUND INSTRUCTIONS at the very end take precedence over these where they conflict):
- Ask ONE question at a time and wait for the candidate to finish before responding.
- Move through the areas in order.
- If an answer is under 15 words, treat it as incomplete and ask them to go deeper.
- Strong answer: acknowledge briefly, then either follow up or move on.
- Medium answer: ask one clarifying follow-up.
- Weak answer: drop to a more foundational question.
- Transition naturally between areas.

Be conversational and human:
- Short, direct questions (max 2 sentences).
- Never open with "Can you", "Could you", "Would you mind".
- Avoid filler like "elaborate", "explain in detail", "walk me through".
- No praise or encouragement — stay professional and neutral.
- You are read aloud by a text-to-speech engine. Write acronyms with spaces between the letters so they are pronounced correctly: write "A P I", not "API". Same for S Q L, R E S T, C I C D, H T T P, J S O N. Never let an acronym run together with the following word.

PAUSE HANDLING:
- Candidates think before they answer. Silence is not a finished answer.
- If the candidate says "let me think", "give me a second", or similar, do not respond at all. Never announce that you are waiting. Never narrate your own behavior. Phrases like "remaining silent", "I'll wait", or any stage direction are strictly forbidden. Everything you output is spoken aloud to the candidate.
- If the candidate pauses mid-answer, assume they are still constructing the thought. Wait. A pause after "so the way I'd approach that is..." is a thinking pause, not a turn end.
- Only speak when the candidate has clearly handed the turn back: a complete thought followed by silence, or an explicit signal like "that's my answer" or a direct question to you.
- Never interrupt. If you and the candidate speak at the same time, stop immediately and yield.
- Never treat silence as the interview being finished. Silence is never a reason to conclude or to use end_call.

CONCLUDING (overrides the question counts in ROUND INSTRUCTIONS):

You may not conclude until every area listed above has been genuinely explored. An area is explored when it has at least one primary question asked AND at least one answer you classified SUBSTANTIVE, or an explicit "I don't know" from the candidate.

The question counts in ROUND INSTRUCTIONS describe depth per area. They are NOT a termination condition. Never conclude because you reached a number. Never conclude while any area is untouched. Follow-ups do not count toward those numbers; only primary questions do.

To conclude, say the closing phrase exactly, then use the end_call tool.

OPENING:
Your very first turn must be a single short opening containing BOTH a brief greeting AND your first interview question. One turn, not two. Shape:
"Hi, I'm Sage. Let's get started. [first question about ${plan.areas[0].name}]"
One sentence of greeting, then straight into the question. Do not wait for the candidate to speak. Do not ask if they are ready.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ROUND INSTRUCTIONS (HIGHEST PRIORITY — these override anything above):
${roundDirective[roundType]}`;
}

// ─────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────
export default function Home() {
  const { isSignedIn, userId } = useAuth();

  const [appPhase, setAppPhase] = useState<AppPhase>('landing');
  // role/experienceLevel/interviewType are set once at interview start, not per-keystroke
  const [role, setRole] = useState('');
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>('mid-level');
  const [interviewType, setInterviewType] = useState<InterviewType>('mixed');
  const [agentState, setAgentState] = useState<ExaminerState | null>(null);
  const [error, setError] = useState('');
  const [loadingMsg, setLoadingMsg] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showReadyScreen, setShowReadyScreen] = useState(false);
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [topicAreas, setTopicAreas] = useState<any[]>([]);
  const [saveToast, setSaveToast] = useState<{ message: string; tone: 'error' | 'warning' } | null>(null);

  const agentStateRef = useRef<ExaminerState | null>(null);
  const isMobile = useRef(false);
  // Mobile pre-fetch: stores the initialization promise so handleReadyBegin
  // can await it without a network round-trip inside the gesture handler.
  const mobileInitPromiseRef = useRef<Promise<{ plan: InterviewPlan }> | null>(null);
  const userSyncedRef = useRef(false);
  // Bumped by handleRestart so an in-flight /api/realtime/conclude response
  // that resolves after the user has already left this session gets discarded
  // instead of clobbering the fresh state with a stale evaluation.
  const sessionGenerationRef = useRef(0);
  // The interview plan (areas, gaps, strengths) from /api/realtime/initialize.
  // Only handleStart/handleReadyBegin have it in scope when it's fetched;
  // mirrored here so handleInterviewComplete can forward it to /api/realtime/conclude.
  const planRef = useRef<InterviewPlan | null>(null);

  useEffect(() => {
    isMobile.current =
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
      window.innerWidth < 768;
  }, []);

  useEffect(() => {
    if (!isSignedIn || userSyncedRef.current) return;
    userSyncedRef.current = true;
    fetch('/api/sync-user', { method: 'POST' }).catch(() => {});
  }, [isSignedIn]);

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

    // Snapshot the generation counter — if the user restarts before this
    // request resolves, sessionGenerationRef will have moved on and the
    // result below gets discarded instead of clobbering the fresh session.
    const myGeneration = sessionGenerationRef.current;

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
        clerkUserId: userId ?? null,
        plan: planRef.current,
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

      if (sessionGenerationRef.current !== myGeneration) {
        console.log('[handleInterviewComplete] Stale response (user restarted) — discarding');
        return;
      }

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

      // The evaluation always renders — the Supabase write happens server-side
      // and is best-effort. Surface it if it silently didn't happen for a
      // signed-in candidate, since they'd otherwise assume it was saved.
      if (userId && !data.sessionSaved) {
        console.error('[handleInterviewComplete] ⚠️ Session was not saved:', data.saveError);
        setSaveToast({
          message: "Your evaluation was generated, but we couldn't save it to your history. Use Download Report below to keep a copy.",
          tone: 'warning',
        });
      }

      console.log('[handleInterviewComplete] ✅ Phase transition to complete successful');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    } catch (err) {
      console.error('[handleInterviewComplete Error] ❌', err);
      if (sessionGenerationRef.current !== myGeneration) {
        console.log('[handleInterviewComplete] Stale failure (user restarted) — discarding');
        return;
      }
      setError('Failed to generate evaluation. Please try again.');
      setSaveToast({
        message: 'Something went wrong generating your evaluation. Please try the interview again.',
        tone: 'error',
      });
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
  }, [realtimeSession, role, experienceLevel, interviewType, userId]);


  const handleStart = useCallback(async (
    payload: { resumePdfBase64: string; jobDescription: string; roundType: 'screening' | 'technical' | 'final' },
  ) => {
    const t0 = performance.now();
    console.log(`[TIMING] handleStart: Begin Interview clicked at ${t0.toFixed(2)}ms`);

    setError('');
    setShowForm(false);
    setAppPhase('loading');
    setLoadingMsg('Analyzing role requirements...');

    try {
      setTimeout(() => setLoadingMsg('Building interview areas...'), 800);
      setTimeout(() => setLoadingMsg('Connecting to Sage...'), 1600);

      const t1 = performance.now();
      console.log(`[TIMING] handleStart: Initializing topic areas at ${t1.toFixed(2)}ms`);

      const initRes = await fetch('/api/realtime/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumePdfBase64: payload.resumePdfBase64,
          jobDescription: payload.jobDescription,
          roundType: payload.roundType,
        }),
      });

      const initData = await initRes.json();
      if (!initRes.ok) throw new Error(initData.error);

      const plan: InterviewPlan = initData;
      planRef.current = plan;
      const t2 = performance.now();
      console.log(`[TIMING] handleStart: Topic areas initialized at ${t2.toFixed(2)}ms (+${(t2-t1).toFixed(2)}ms)`);

      // Commit plan values to Home state (used by session/complete display)
      setRole(plan.role);
      setExperienceLevel(plan.seniority);
      setInterviewType(payload.roundType as any);

      realtimeSession.initializeInterview(plan.topicAreas);
      setTopicAreas(plan.topicAreas);

      const systemPrompt = buildVapiSystemPrompt(plan, payload.roundType);

      const t3 = performance.now();
      console.log(`[TIMING] handleStart: Connecting to Vapi at ${t3.toFixed(2)}ms`);

      await realtimeSession.connect(systemPrompt, {
        topic: plan.role,
        level: plan.seniority,
        interviewType: payload.roundType,
      });

      const t4 = performance.now();
      console.log(`[TIMING] handleStart: Realtime session ready at ${t4.toFixed(2)}ms (+${(t4-t3).toFixed(2)}ms)`);

      // Detect mobile for optimized startup
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;

      // Move to session phase FIRST - this shows the UI immediately
      setAppPhase('session');

      // On mobile: add a small delay to ensure UI renders before starting audio
      // This makes the loading feel faster by showing the interview screen sooner
      if (isMobile) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Now start audio capture - this can happen in background while UI is visible
      await realtimeSession.startAudioCapture();

      const t5 = performance.now();
      console.log(`[TIMING] handleStart: Audio capture started at ${t5.toFixed(2)}ms (+${(t5-t4).toFixed(2)}ms)`);
      console.log(`[TIMING] handleStart: Total initialization time: ${(t5-t0).toFixed(2)}ms`);

    } catch (err: any) {
      console.error('[handleStart Error]', err);
      setError(err.message || 'Failed to start. Check your API key.');
      setShowForm(true);
      setAppPhase('landing');
    }
  }, [realtimeSession]);

  // Intercepts the form's onStart.
  // Desktop → calls handleStart immediately.
  // Mobile  → shows ReadyScreen overlay so the user can unlock audio in their own tap.

  const handleFormSubmit = useCallback((
    payload: { resumePdfBase64: string; jobDescription: string; roundType: 'screening' | 'technical' | 'final' },
  ) => {
    if (!isSignedIn) {
      setShowForm(false);
      setShowAuthGate(true);
      return;
    }

    const isMobileDevice =
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
      window.innerWidth < 768 ||
      ('ontouchstart' in window);

    setShowForm(false);

    if (isMobileDevice) {
      // Pre-fetch the plan NOW while ReadyScreen is displayed so handleReadyBegin
      // can start Vapi immediately after "I'm Ready" — no network round-trip inside
      // the gesture handler, which would invalidate iOS's user-gesture audio context.
      mobileInitPromiseRef.current = fetch('/api/realtime/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumePdfBase64: payload.resumePdfBase64,
          jobDescription: payload.jobDescription,
          roundType: payload.roundType,
        }),
      }).then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        const plan: InterviewPlan = data;
        setRole(plan.role);
        setExperienceLevel(plan.seniority);
        setInterviewType(payload.roundType as any);
        return { plan };
      });

      setShowReadyScreen(true);
    } else {
      handleStart(payload);
    }
  }, [handleStart, isSignedIn]);

  // Called by the "I'm Ready" button on the ReadyScreen (mobile only).
  // IMPORTANT: iOS requires that both getUserMedia AND vapi.start() happen
  // within the same user-gesture context. We pre-fetched the topic areas in
  // handleFormSubmit so there's no network request here — only the permission
  // prompt and the Vapi call, which stay inside the gesture chain.
  const handleReadyBegin = useCallback(async () => {
    setShowReadyScreen(false);
    setAppPhase('loading');
    setLoadingMsg('Connecting to Sage...');

    try {
      const { plan } = await (mobileInitPromiseRef.current ?? Promise.reject(new Error('No init data')));
      planRef.current = plan;

      realtimeSession.initializeInterview(plan.topicAreas);
      setTopicAreas(plan.topicAreas);

      // Unlock iOS WebRTC audio output — must happen inside the gesture chain
      // (which we preserve because the only await above is a pre-resolved or
      // nearly-resolved fetch promise, not a new network request).
      // Stop the tracks immediately: Vapi calls its own getUserMedia internally
      // and a concurrent live stream silently blocks its mic acquisition on iOS.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
      } catch (_) {
        // Permission denied or unavailable — let Vapi surface its own error.
      }

      const systemPrompt = buildVapiSystemPrompt(plan, plan.roundType as 'screening' | 'technical' | 'final');

      await realtimeSession.connect(systemPrompt, {
        topic: plan.role,
        level: plan.seniority,
        interviewType: plan.roundType,
      });

      setAppPhase('session');
      await realtimeSession.startAudioCapture();
    } catch (err: any) {
      console.error('[handleReadyBegin Error]', err);
      setError(err.message || 'Failed to start. Please try again.');
      setAppPhase('landing');
      setShowForm(true);
    }
  }, [realtimeSession]);

  const handleRestart = () => {
    // Invalidate any in-flight /api/realtime/conclude response from the
    // session being left — see sessionGenerationRef in handleInterviewComplete.
    sessionGenerationRef.current += 1;
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
    setSaveToast(null);
    setShowForm(false);
    setShowReadyScreen(false);
    agentStateRef.current = null;
    planRef.current = null;
  };

  return (
    <main className={appPhase === 'landing'
      ? 'min-h-screen'
      : 'min-h-screen flex flex-col items-center justify-center px-6 py-12'
    } style={{ background: 'var(--bg)' }}>

      {saveToast && (
        <SaveStatusToast
          message={saveToast.message}
          tone={saveToast.tone}
          onDismiss={() => setSaveToast(null)}
        />
      )}

      {/* ── LANDING (marketing page) ── */}
      {appPhase === 'landing' && (
        <>
          <LandingPage onCtaClick={handleShowForm} />
          {/* Always mounted — visibility toggled with CSS to avoid mount cost on click */}
          <InterviewForm
            isVisible={showForm}
            onStart={handleFormSubmit}
            onClose={handleHideForm}
            unlockAudio={unlockAudio}
            isSupported={isSupported}
            error={error}
          />
        </>
      )}

      {/* ── AUTH GATE (second session, unauthenticated) ── */}
      {showAuthGate && (
        <AuthGate onClose={() => setShowAuthGate(false)} />
      )}

      {/* ── READY SCREEN (mobile only) ── */}
      {/* Rendered as a fixed overlay independently of appPhase so it can sit
          between the form close and the loading phase starting. */}
      {showReadyScreen && (
        <ReadyScreen
          role={role}
          experienceLevel={experienceLevel}
          interviewType={interviewType}
          onBegin={handleReadyBegin}
        />
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

          {(() => {
            const orbStatus = realtimeSession.isSageSpeaking
              ? 'speaking'
              : realtimeSession.isUserSpeaking
              ? 'listening'
              : realtimeSession.currentTranscript
              ? 'processing'
              : 'idle';
            return (
              <div className="flex flex-col items-center">
                <LiveOrb status={orbStatus} volume={realtimeSession.volumeLevel} />
                <StatusLabel status={orbStatus} />
              </div>
            );
          })()}

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

          <button onClick={handleRestart}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-all duration-300 tracking-widest uppercase mt-4">
            End Session
          </button>
        </div>
      )}

      {/* ── COMPLETE ── */}
      {appPhase === 'complete' && agentState?.finalEvaluation && (
        <EvaluationScreen
          evaluation={agentState.finalEvaluation}
          role={role}
          exchanges={realtimeSession.exchanges}
          onRestart={handleRestart}
        />
      )}
    </main>
  );
}


'use client';

import { useState, useCallback, useRef } from 'react';
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

// ─────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────
export default function Home() {
  const [appPhase, setAppPhase] = useState<AppPhase>('landing');
  const [role, setRole] = useState('');
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>('mid-level');
  const [interviewType, setInterviewType] = useState<InterviewType>('mixed');
  const [agentState, setAgentState] = useState<ExaminerState | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [topicAreas, setTopicAreas] = useState<TopicArea[]>([]);
  const [quality, setQuality] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loadingMsg, setLoadingMsg] = useState('');

  const agentStateRef = useRef<ExaminerState | null>(null);

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

      const [audioBlob] = await Promise.all([
        // Fetch TTS audio
        fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: nextQuestion }),
        }).then(r => r.blob()),
        // Show question on screen immediately
        Promise.resolve(setCurrentQuestion(nextQuestion)),
      ]);

      // Step 3 — play the already-fetched audio immediately
      speakBlob(audioBlob);

    } catch (err) {
      console.error(err);
      setError('Something went wrong. Please try again.');
    }
  }, []);

  const handleSpeakEnd = useCallback(() => {}, []);

  const { status, transcript, isSupported, silenceCountdown, speak, speakBlob, cancel } = useSpeech({
    onTranscript: handleTranscript,
    onSpeakEnd: handleSpeakEnd,
  });

  const handleStart = async () => {
    if (!role.trim()) return;
    setError('');
    setAppPhase('loading');
    setLoadingMsg('Analyzing role requirements...');

    try {
      setTimeout(() => setLoadingMsg('Building interview areas...'), 1200);
      setTimeout(() => setLoadingMsg('Preparing first question...'), 2400);

      const topic = `${role.trim()} — ${interviewType} interview — ${experienceLevel} level`;

      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          topic,
          role: role.trim(),
          experienceLevel,
          interviewType,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      agentStateRef.current = data.state;
      setAgentState(data.state);
      setTopicAreas(data.topicAreas);
      setCurrentQuestion(data.question);
      setAppPhase('session');

      speak(data.question);

    } catch (err: any) {
      setError(err.message || 'Failed to start. Check your API key.');
      setAppPhase('landing');
    }
  };

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
    agentStateRef.current = null;
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12"
      style={{ background: 'var(--bg)' }}>

      {/* ── LANDING ── */}
      {appPhase === 'landing' && (
        <div className="flex flex-col items-center gap-8 animate-fade-in w-full max-w-md">
          <div className="text-center">
            <h1 className="text-6xl text-[var(--text-primary)] mb-3"
              style={{ fontFamily: 'DM Serif Display, serif' }}>
              Sage
            </h1>
            <p className="text-lg text-[var(--text-secondary)]">
              Let's get you interview ready.
            </p>
          </div>

          <div className="w-full flex flex-col gap-4">
            {/* Role input */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--text-secondary)] tracking-widest uppercase">
                Role you're interviewing for
              </label>
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleStart()}
                placeholder="e.g. Software Engineer, Product Manager..."
                className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-all duration-300"
              />
            </div>

            {/* Experience level */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--text-secondary)] tracking-widest uppercase">
                Experience level
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['junior', 'mid-level', 'senior'] as ExperienceLevel[]).map((level) => (
                  <button key={level}
                    onClick={() => setExperienceLevel(level)}
                    className="py-2 rounded-lg text-xs tracking-widest uppercase transition-all duration-200 border"
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
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--text-secondary)] tracking-widest uppercase">
                Interview type
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['behavioral', 'technical', 'mixed'] as InterviewType[]).map((type) => (
                  <button key={type}
                    onClick={() => setInterviewType(type)}
                    className="py-2 rounded-lg text-xs tracking-widest uppercase transition-all duration-200 border"
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

            <button onClick={handleStart} disabled={!role.trim()}
              className="w-full py-3 rounded-lg text-sm tracking-widest uppercase transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed mt-2"
              style={{
                background: role.trim() ? 'var(--accent)' : 'var(--surface)',
                color: role.trim() ? 'var(--bg)' : 'var(--text-muted)',
              }}>
              Begin Interview
            </button>
          </div>

          {!isSupported && (
            <p className="text-xs text-[var(--red)] text-center">
              Voice not supported. Use Chrome or Edge.
            </p>
          )}
        </div>
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
/**
 * useRealtimeSession
 *
 * Powers the Sage interview engine via the Vapi WebRTC SDK.
 * All WebSocket / AudioContext / PCM resampling logic has been removed —
 * Vapi manages the full media pipeline (microphone, speaker, VAD, echo
 * cancellation) transparently across Chrome, Safari, Firefox and mobile.
 *
 * Public interface is unchanged so page.tsx requires only one tiny call-site tweak.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Vapi from '@vapi-ai/web';
import type { TopicArea, ExchangeRecord } from '@/lib/agent/types';

// ── Re-export shared types so existing import paths keep working ─────────────
export type { TopicArea, ExchangeRecord };
export type RealtimeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type AnswerQuality = 'strong' | 'medium' | 'weak' | 'incomplete';

// Vapi assistant configured in the Vapi dashboard
const VAPI_ASSISTANT_ID = '85a73bb3-d87d-4a5a-bd62-55ee094e40eb';

// ── Hook options (unchanged from legacy hook) ────────────────────────────────
interface UseRealtimeSessionOptions {
  onQuestionReceived?: (question: string) => void;
  onTranscriptUpdate?: (transcript: string) => void;
  onResponseStart?: () => void;
  onResponseEnd?: () => void;
  onError?: (error: string) => void;
  onInterviewComplete?: () => void;
  onSessionReady?: () => void;
}

// ── Variable overrides passed to the Vapi assistant at call start ────────────
export interface VapiSessionVariables {
  topic?: string;       // e.g. "AI Engineer"
  level?: string;       // e.g. "mid-level"
  interviewType?: string; // e.g. "mixed"
}

// ────────────────────────────────────────────────────────────────────────────
export function useRealtimeSession(options: UseRealtimeSessionOptions = {}) {
  // ── UI state ─────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<RealtimeStatus>('disconnected');
  const [error, setError] = useState('');
  const [isSageSpeaking, setIsSageSpeaking] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [currentQuestion, setCurrentQuestion] = useState('');

  // ── Volume level (0-1, from Vapi volume-level event) ─────────────────────
  const [volumeLevel, setVolumeLevel] = useState(0);

  // ── Interview tracking state ──────────────────────────────────────────────
  const [topicAreas, setTopicAreas] = useState<TopicArea[]>([]);
  const [exchanges, setExchanges] = useState<ExchangeRecord[]>([]);
  const [currentAreaIndex, setCurrentAreaIndex] = useState(0);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const vapiRef = useRef<Vapi | null>(null);
  const optionsRef = useRef(options);
  const topicAreasRef = useRef<TopicArea[]>([]);
  const exchangesRef = useRef<ExchangeRecord[]>([]);
  const currentAreaIndexRef = useRef(0);
  const currentQuestionRef = useRef('');

  // Always keep callbacks current so event listeners never stale-close
  useEffect(() => { optionsRef.current = options; });

  // Keep refs in sync with state
  useEffect(() => { topicAreasRef.current = topicAreas; }, [topicAreas]);
  useEffect(() => { exchangesRef.current = exchanges; }, [exchanges]);
  useEffect(() => { currentAreaIndexRef.current = currentAreaIndex; }, [currentAreaIndex]);
  useEffect(() => { currentQuestionRef.current = currentQuestion; }, [currentQuestion]);

  // ── Initialize interview (called before connect) ─────────────────────────
  const initializeInterview = useCallback((areas: TopicArea[]) => {
    const areasWithCount = areas.map(a => ({ ...a, questionCount: a.questionCount || 0 }));
    setTopicAreas(areasWithCount);
    setCurrentAreaIndex(0);
    setExchanges([]);
    setCurrentQuestion('');
    setCurrentTranscript('');
  }, []);

  // ── Connect — starts a Vapi call ─────────────────────────────────────────
  //
  // systemPrompt is injected directly as a model-messages override so the app
  // is self-contained and doesn't depend on the Vapi dashboard system prompt.
  // variables are also injected via assistantOverrides.variableValues for any
  // {{template}} placeholders still in the dashboard config.
  const connect = useCallback(async (
    systemPrompt?: string,
    variables?: VapiSessionVariables,
  ): Promise<void> => {
    const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
    if (!publicKey) {
      const msg = 'NEXT_PUBLIC_VAPI_PUBLIC_KEY env variable is not set';
      console.error('[Vapi]', msg);
      setStatus('error');
      setError(msg);
      optionsRef.current.onError?.(msg);
      return;
    }

    // Teardown any previous call before starting a new one
    if (vapiRef.current) {
      try { vapiRef.current.stop(); } catch (_) {}
      vapiRef.current = null;
    }

    setStatus('connecting');
    setError('');

    const vapi = new Vapi(publicKey);
    vapiRef.current = vapi;

    // ── call-start: Vapi WebRTC is live ─────────────────────────────────
    vapi.on('call-start', () => {
      console.log('[Vapi] Call started');
      setStatus('connected');
      optionsRef.current.onSessionReady?.();
    });

    // ── call-end: session finished (Sage said goodbye or user ended) ─────
    vapi.on('call-end', () => {
      console.log('[Vapi] Call ended');
      setStatus('disconnected');
      setIsSageSpeaking(false);
      setIsUserSpeaking(false);
      setVolumeLevel(0);
      optionsRef.current.onInterviewComplete?.();
    });

    // ── speech-start / speech-end: Sage is speaking ──────────────────────
    vapi.on('speech-start', () => {
      console.log('[Vapi] Sage started speaking');
      setIsSageSpeaking(true);
      optionsRef.current.onResponseStart?.();
    });

    vapi.on('speech-end', () => {
      console.log('[Vapi] Sage stopped speaking');
      setIsSageSpeaking(false);
      optionsRef.current.onResponseEnd?.();
    });

    // ── message: transcripts + structured outputs ─────────────────────────
    vapi.on('message', (msg: any) => {
      // ── Transcript events ─────────────────────────────────────────────
      if (msg.type === 'transcript') {
        const { role, transcriptType, transcript } = msg as {
          role: 'assistant' | 'user';
          transcriptType: 'partial' | 'final';
          transcript: string;
        };

        if (role === 'assistant') {
          // Stream Sage's words to the question display in real time
          setCurrentQuestion(transcript);
          if (transcriptType === 'final') {
            currentQuestionRef.current = transcript;
            console.log('[Vapi] Sage final:', transcript);
            optionsRef.current.onQuestionReceived?.(transcript);
          }
        } else if (role === 'user') {
          if (transcriptType === 'partial') {
            setIsUserSpeaking(true);
            setCurrentTranscript(transcript);
            optionsRef.current.onTranscriptUpdate?.(transcript);
          } else if (transcriptType === 'final') {
            setIsUserSpeaking(false);
            setCurrentTranscript(transcript);
            optionsRef.current.onTranscriptUpdate?.(transcript);
            console.log('[Vapi] User final:', transcript);

            // ── Record exchange for post-call evaluation ───────────────
            const trimmed = transcript.trim();
            if (trimmed && currentQuestionRef.current) {
              const currentArea = topicAreasRef.current[currentAreaIndexRef.current];
              const newExchange: ExchangeRecord = {
                areaId: currentArea?.id || 'unknown',
                question: currentQuestionRef.current,
                answer: trimmed,
                quality: 'medium', // Placeholder — final evaluation is generated post-call
                feedback: '',
                timestamp: Date.now(),
              };

              setExchanges(prev => {
                const updated = [...prev, newExchange];
                console.log('[Vapi] Exchange recorded — total:', updated.length);
                return updated;
              });

              // Increment question count for current area
              setTopicAreas(prev => prev.map((area, idx) =>
                idx === currentAreaIndexRef.current
                  ? { ...area, questionCount: (area.questionCount || 0) + 1 }
                  : area,
              ));

              // Advance to next topic area after 2 questions
              const nextCount = (currentArea?.questionCount || 0) + 1;
              const hasMore = currentAreaIndexRef.current < topicAreasRef.current.length - 1;
              if (nextCount >= 2 && hasMore) {
                setTopicAreas(prev => prev.map((area, idx) =>
                  idx === currentAreaIndexRef.current ? { ...area, covered: true } : area,
                ));
                setCurrentAreaIndex(prev => prev + 1);
                console.log('[Vapi] Advancing to next topic area');
              }
            }
          }
        }
        return;
      }

      // ── End-of-call report: capture Vapi's structured analysis ────────
      // If the assistant is configured to produce an analysis object, it
      // arrives here. We log it so it can be used or forwarded in the future.
      if (msg.type === 'end-of-call-report') {
        console.log('[Vapi] End-of-call report:', JSON.stringify(msg, null, 2));
        // analysis is available at msg.analysis if the assistant outputs it
      }
    });

    // ── volume-level: mic/speaker volume for orb reactivity ─────────────
    vapi.on('volume-level', (level: number) => {
      setVolumeLevel(level);
    });

    // ── error ─────────────────────────────────────────────────────────────
    vapi.on('error', (e: any) => {
      const msg = e?.message ?? e?.error?.message ?? (typeof e === 'string' ? e : JSON.stringify(e)) ?? 'Vapi error';
      console.error('[Vapi] Error details:', JSON.stringify(e, null, 2));
      setStatus('error');
      setError(msg);
      optionsRef.current.onError?.(msg);
    });

    // ── Start the call with assistant overrides ───────────────────────────
    // vapi.start(assistantId, assistantOverrides) — the second argument IS the
    // AssistantOverrides object; do NOT wrap it in a nested { assistantOverrides: {} }.
    const variableValues = {
      topic: variables?.topic ?? '',
      level: variables?.level ?? '',
      interviewType: variables?.interviewType ?? '',
    };

    const overrides: any = {
      variableValues,
    };

    // Pass the full system prompt directly so the app works without relying
    // on the Vapi dashboard assistant's system prompt configuration.
    if (systemPrompt) {
      overrides.model = {
        provider: 'openai',
        model: 'gpt-4o',
        messages: [{ role: 'system', content: systemPrompt }],
        temperature: 0.8,
      };
    }

    console.log('[Vapi] Starting call with overrides:', JSON.stringify({ variableValues, firstMessage: overrides.firstMessage }));
    try {
      await vapi.start(VAPI_ASSISTANT_ID, overrides);
    } catch (err: any) {
      const msg = err?.message ?? (typeof err === 'string' ? err : JSON.stringify(err)) ?? 'Failed to start Vapi call';
      console.error('[Vapi] Start error:', JSON.stringify(err));
      setStatus('error');
      setError(msg);
      optionsRef.current.onError?.(msg);
    }
  }, []); // stable — all live values accessed via refs

  // ── Disconnect ────────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    if (vapiRef.current) {
      try { vapiRef.current.stop(); } catch (_) {}
      vapiRef.current = null;
    }
    setStatus('disconnected');
    setError('');
    setIsSageSpeaking(false);
    setIsUserSpeaking(false);
  }, []);

  // ── Audio capture stubs ──────────────────────────────────────────────────
  // Vapi manages the microphone internally via WebRTC — no manual capture needed.
  // These stubs preserve the existing call-sites in page.tsx without changes.
  const startAudioCapture = useCallback(async () => {
    console.log('[Vapi] startAudioCapture: microphone is managed by the Vapi SDK');
  }, []);

  const stopAudioCapture = useCallback(() => {
    console.log('[Vapi] stopAudioCapture: microphone is managed by the Vapi SDK');
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (vapiRef.current) {
        try { vapiRef.current.stop(); } catch (_) {}
        vapiRef.current = null;
      }
    };
  }, []);

  // ── Public API (identical shape to legacy hook) ───────────────────────────
  return {
    status,
    error,
    isSageSpeaking,
    isUserSpeaking,
    currentTranscript,
    currentQuestion,
    topicAreas,
    exchanges,
    currentAreaIndex,
    volumeLevel,
    connect,
    disconnect,
    startAudioCapture,
    stopAudioCapture,
    initializeInterview,
  };
}

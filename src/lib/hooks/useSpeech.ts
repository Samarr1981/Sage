import { useCallback, useEffect, useRef, useState } from 'react';

export type SpeechStatus = 'idle' | 'speaking' | 'listening' | 'processing';

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

interface UseSpeechOptions {
  onTranscript: (text: string) => void;
  onSpeakEnd: () => void;
}

export function useSpeech({ onTranscript, onSpeakEnd }: UseSpeechOptions) {
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const [isSupported, setIsSupported] = useState(true);
  const [silenceCountdown, setSilenceCountdown] = useState<number | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptRef = useRef('');
  const isListeningRef = useRef(false);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onSpeakEndRef = useRef(onSpeakEnd);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onSpeakEndRef.current = onSpeakEnd;
  }, [onSpeakEnd]);

  // ── Clear silence timer ────────────────────
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    silenceTimerRef.current = null;
    countdownIntervalRef.current = null;
    setSilenceCountdown(null);
  }, []);

  // ── Start silence timer ────────────────────
  const startSilenceTimer = useCallback(() => {
    // Always clear existing timer first — this is the reset
    clearSilenceTimer();

    let secondsLeft = 3;
    setSilenceCountdown(secondsLeft);

    countdownIntervalRef.current = setInterval(() => {
      secondsLeft -= 1;
      setSilenceCountdown(secondsLeft);
      if (secondsLeft <= 0) {
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      }
    }, 1000);

    silenceTimerRef.current = setTimeout(() => {
      setSilenceCountdown(null);
      const finalAnswer = transcriptRef.current.trim();
      if (finalAnswer && isListeningRef.current) {
        isListeningRef.current = false;
        setStatus('processing');
        try { recognitionRef.current?.stop(); } catch (e) { /* ignore */ }
        onTranscriptRef.current(finalAnswer);
      }
    }, 3000);
  }, [clearSilenceTimer]);

  // ── Setup speech recognition ───────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    // continuous true — mic stays open through pauses
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript + ' ';
        } else {
          interim += result[0].transcript;
        }
      }

      if (final) {
        transcriptRef.current += final;
      }

      const displayed = (transcriptRef.current + interim).trim();
      setTranscript(displayed);

      // Reset silence timer every time speech comes in
      if (displayed) {
        startSilenceTimer();
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // no-speech is fine — mic is open but user hasn't spoken yet
      if (event.error === 'no-speech') return;
      console.error('[Speech Recognition Error]', event.error);
    };

    recognition.onend = () => {
      // If we're still supposed to be listening, restart
      // This handles Chrome's auto-stop after silence
      if (isListeningRef.current) {
        try {
          recognition.start();
        } catch (e) {
          // ignore — already restarting
        }
      }
    };

    recognitionRef.current = recognition;

    return () => {
      isListeningRef.current = false;
      recognition.abort();
      clearSilenceTimer();
    };
  }, [clearSilenceTimer, startSilenceTimer]);

  // ── Unlock audio on first user gesture ────
  const unlockAudio = useCallback(() => {
    if (audioRef.current) return;
    const audio = new Audio();
    audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    audio.play().catch(() => {});
    audioRef.current = audio;
  }, []);

  // ── Speak using OpenAI TTS API ─────────────
  const speak = useCallback(async (text: string) => {
    setStatus('speaking');
    isListeningRef.current = false;

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) throw new Error('TTS request failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = audioRef.current || new Audio();
      audioRef.current = audio;
      audio.src = url;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        setStatus('listening');
        onSpeakEndRef.current();
        setTimeout(() => {
          transcriptRef.current = '';
          setTranscript('');
          clearSilenceTimer();
          isListeningRef.current = true;
          try {
            recognitionRef.current?.start();
          } catch (e) {
            console.error('[Recognition Start Error]', e);
          }
        }, 500);
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setStatus('idle');
      };

      await audio.play();

    } catch (err) {
      console.error('[TTS Error]', err);
      setStatus('idle');
    }
  }, [clearSilenceTimer]);

  // ── speakBlob — play pre-fetched audio ─────
  const speakBlob = useCallback((blob: Blob) => {
    setStatus('speaking');
    isListeningRef.current = false;

    try {
      const url = URL.createObjectURL(blob);
      const audio = audioRef.current || new Audio();
      audioRef.current = audio;
      audio.src = url;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        setStatus('listening');
        onSpeakEndRef.current();
        setTimeout(() => {
          transcriptRef.current = '';
          setTranscript('');
          clearSilenceTimer();
          isListeningRef.current = true;
          try {
            recognitionRef.current?.start();
          } catch (e) {
            console.error('[Recognition Start Error]', e);
          }
        }, 500);
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setStatus('idle');
      };

      audio.play().catch(err => {
        console.error('[Audio play error]', err);
        setStatus('idle');
      });

    } catch (err) {
      console.error('[speakBlob Error]', err);
      setStatus('idle');
    }
  }, [clearSilenceTimer]);

  // ── Start listening ────────────────────────
  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    transcriptRef.current = '';
    setTranscript('');
    setStatus('listening');
    isListeningRef.current = true;
    clearSilenceTimer();
    try {
      recognitionRef.current.start();
    } catch (e) {
      console.error('[Recognition Start Error]', e);
    }
  }, [clearSilenceTimer]);

  // ── Cancel everything ──────────────────────
  const cancel = useCallback(() => {
    isListeningRef.current = false;
    clearSilenceTimer();
    recognitionRef.current?.abort();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    transcriptRef.current = '';
    setStatus('idle');
    setTranscript('');
  }, [clearSilenceTimer]);

  return {
    status,
    transcript,
    isSupported,
    silenceCountdown,
    speak,
    speakBlob,
    startListening,
    unlockAudio,
    cancel,
  };
}
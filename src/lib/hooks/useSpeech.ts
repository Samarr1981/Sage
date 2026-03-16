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
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const accumulatedRef = useRef('');
  const isListeningRef = useRef(false);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  // ── Clear silence timer ────────────────────
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setSilenceCountdown(null);
  }, []);

  // ── Start silence timer ────────────────────
  // Submits answer after 3 seconds of silence
  const startSilenceTimer = useCallback(() => {
    clearSilenceTimer();

    let secondsLeft = 3;
    setSilenceCountdown(secondsLeft);

    countdownIntervalRef.current = setInterval(() => {
      secondsLeft -= 1;
      setSilenceCountdown(secondsLeft);
      if (secondsLeft <= 0) {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
        }
      }
    }, 1000);

    silenceTimerRef.current = setTimeout(() => {
      setSilenceCountdown(null);
      const finalAnswer = accumulatedRef.current.trim();
      if (finalAnswer && isListeningRef.current) {
        isListeningRef.current = false;
        accumulatedRef.current = '';
        setStatus('processing');
        try { recognitionRef.current?.stop(); } catch (e) { /* ignore */ }
        onTranscriptRef.current(finalAnswer);
      }
    }, 3000);
  }, [clearSilenceTimer]);

  // ── Setup on mount ─────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition || !window.speechSynthesis) {
      setIsSupported(false);
      return;
    }

    synthRef.current = window.speechSynthesis;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
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
        accumulatedRef.current += final;
      }

      const displayed = (accumulatedRef.current + interim).trim();
      setTranscript(displayed);

      // Reset silence timer every time new speech comes in
      if (displayed) {
        startSilenceTimer();
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech') {
        if (isListeningRef.current) {
          try { recognition.start(); } catch (e) { /* ignore */ }
        }
        return;
      }
      console.error('[Speech Recognition Error]', event.error);
    };

    recognition.onend = () => {
      if (isListeningRef.current) {
        try { recognition.start(); } catch (e) { /* ignore */ }
      }
    };

    recognitionRef.current = recognition;

    return () => {
      isListeningRef.current = false;
      clearSilenceTimer();
      recognition.abort();
      synthRef.current?.cancel();
    };
  }, [startSilenceTimer, clearSilenceTimer]);

  // ── Speak ──────────────────────────────────
  const speak = useCallback((text: string) => {
    if (!synthRef.current) return;

    synthRef.current.cancel();
    setStatus('speaking');

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
utterance.pitch = 1.05;
utterance.volume = 1.0;

    const voices = synthRef.current.getVoices();
    const preferred = voices.find(v => v.name === 'Google US English') ||
  voices.find(v => v.name.includes('Samantha')) ||
  voices.find(v => v.name.includes('Alex')) ||
  voices.find(v => v.lang === 'en-US' && !v.name.includes('Google')) ||
  voices.find(v => v.lang === 'en-US');
    if (preferred) utterance.voice = preferred;

    utterance.onend = () => {
      setStatus('listening');
      onSpeakEnd();
      setTimeout(() => startListening(), 300);
    };

    utterance.onerror = () => {
      setStatus('idle');
    };

    synthRef.current.speak(utterance);
  }, [onSpeakEnd]);

  // ── Start listening ────────────────────────
  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;

    accumulatedRef.current = '';
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
    synthRef.current?.cancel();
    accumulatedRef.current = '';
    setStatus('idle');
    setTranscript('');
  }, [clearSilenceTimer]);

  return {
    status,
    transcript,
    isSupported,
    silenceCountdown,
    speak,
    startListening,
    cancel,
  };
}
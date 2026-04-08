import { useCallback, useEffect, useRef, useState } from 'react';

export type SpeechStatus = 'idle' | 'speaking' | 'listening' | 'processing';
export type SpeechMode   = 'webSpeech' | 'mediaRecorder' | 'none';

// ── Web Speech API types ──────────────────────
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

// ── Best audio MIME type for MediaRecorder ────
function getBestMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export function useSpeech({ onTranscript, onSpeakEnd }: UseSpeechOptions) {
  const [status,           setStatus]           = useState<SpeechStatus>('idle');
  const [transcript,       setTranscript]       = useState('');
  const [isSupported,      setIsSupported]      = useState(true);
  const [silenceCountdown, setSilenceCountdown] = useState<number | null>(null);
  const [speechMode,       setSpeechMode]       = useState<SpeechMode>('none');
  const [isRecording,      setIsRecording]      = useState(false);
  // Set when mic access fails — displayed in the UI so the user knows what went wrong
  const [micError,         setMicError]         = useState('');

  // ── Refs ──────────────────────────────────────
  const speechModeRef       = useRef<SpeechMode>('none');
  const audioRef            = useRef<HTMLAudioElement | null>(null);
  const transcriptRef       = useRef('');
  const isListeningRef      = useRef(false);
  const silenceTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef= useRef<ReturnType<typeof setInterval> | null>(null);
  const onTranscriptRef     = useRef(onTranscript);
  const onSpeakEndRef       = useRef(onSpeakEnd);
  const isMobileRef         = useRef(false);
  const isSageSpeakingRef   = useRef(false); // Tracks if Sage is currently speaking - prevents speech recognition during TTS playback

  // Web Speech
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // MediaRecorder
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef   = useRef<Blob[]>([]);
  const audioStreamRef   = useRef<MediaStream | null>(null);
  const analysisTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef      = useRef('');

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onSpeakEndRef.current   = onSpeakEnd;   }, [onSpeakEnd]);

  useEffect(() => {
    isMobileRef.current =
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
      window.innerWidth < 768;
  }, []);

  // ── Clear silence timer ───────────────────────
  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current)      clearTimeout(silenceTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    silenceTimerRef.current      = null;
    countdownIntervalRef.current = null;
    setSilenceCountdown(null);
  }, []);

  // ── Silence timer — Web Speech path ──────────
  const startSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    let secondsLeft = 3;
    setSilenceCountdown(secondsLeft);

    countdownIntervalRef.current = setInterval(() => {
      secondsLeft -= 1;
      setSilenceCountdown(secondsLeft);
      if (secondsLeft <= 0 && countdownIntervalRef.current)
        clearInterval(countdownIntervalRef.current);
    }, 1000);

    silenceTimerRef.current = setTimeout(() => {
      setSilenceCountdown(null);
      const finalAnswer = transcriptRef.current.trim();
      if (finalAnswer && isListeningRef.current) {
        isListeningRef.current = false;
        setStatus('processing');
        try { recognitionRef.current?.stop(); } catch (_) {}
        onTranscriptRef.current(finalAnswer);
      }
    }, 3000);
  }, [clearSilenceTimer]);

  // ── Silence timer — MediaRecorder path ───────
  // On expiry just stops the recorder; onstop handles STT.
  const startMRSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    let secondsLeft = 3;
    setSilenceCountdown(secondsLeft);

    countdownIntervalRef.current = setInterval(() => {
      secondsLeft -= 1;
      setSilenceCountdown(secondsLeft);
      if (secondsLeft <= 0 && countdownIntervalRef.current)
        clearInterval(countdownIntervalRef.current);
    }, 1000);

    silenceTimerRef.current = setTimeout(() => {
      setSilenceCountdown(null);
      if (isListeningRef.current && mediaRecorderRef.current?.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch (_) {}
      }
    }, 3000);
  }, [clearSilenceTimer]);

  // ── Stop analysis loop ────────────────────────
  const stopAnalysis = useCallback(() => {
    if (analysisTimerRef.current) {
      clearInterval(analysisTimerRef.current);
      analysisTimerRef.current = null;
    }
  }, []);

  // ── Detect support on mount ───────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hasSpeechRecognition = !!(
      window.SpeechRecognition || window.webkitSpeechRecognition
    );
    // Only check that the global exists; getUserMedia availability (HTTPS) is a
    // runtime concern handled when we actually try to record.
    const hasMediaRecorder = typeof MediaRecorder !== 'undefined';

    if (!hasSpeechRecognition && !hasMediaRecorder) {
      setIsSupported(false);
      speechModeRef.current = 'none';
      setSpeechMode('none');
      return;
    }

    // iOS: all browsers use WebKit — webkitSpeechRecognition is unreliable there,
    // so always use MediaRecorder + Whisper on iOS.
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const mode: SpeechMode =
      hasSpeechRecognition && !isIOS ? 'webSpeech'
      : hasMediaRecorder             ? 'mediaRecorder'
      : 'webSpeech'; // last resort

    speechModeRef.current = mode;
    setSpeechMode(mode);
    mimeTypeRef.current = getBestMimeType();
  }, []);

  // ── Setup Web Speech recognition ─────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    // Android Chrome bug: with continuous:true the engine internally restarts its
    // session and re-emits every previously-finalised result from resultIndex=0,
    // causing words to repeat endlessly (e.g. "when I was doing when I was doing…").
    // Setting continuous:false avoids this — each session gets a fresh results list.
    // The onend handler below already restarts the session manually, so the UX is
    // identical: recognition keeps running through natural pauses on all platforms.
    const isAndroid = /Android/i.test(navigator.userAgent);

    const recognition = new SpeechRecognition();
    recognition.continuous      = !isAndroid; // false on Android, true everywhere else
    recognition.interimResults  = true;
    recognition.lang            = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // CRITICAL: Ignore all speech recognition results while Sage is speaking
      // This prevents picking up Sage's own voice or ambient noise during TTS playback
      if (isSageSpeakingRef.current) {
        console.log('[useSpeech] Ignoring speech recognition result - Sage is currently speaking');
        return;
      }

      let interim = '', final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) final += r[0].transcript + ' ';
        else           interim += r[0].transcript;
      }
      if (final) transcriptRef.current += final;
      const displayed = (transcriptRef.current + interim).trim();
      setTranscript(displayed);
      if (displayed) startSilenceTimer();
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech') return;
      console.error('[Speech Recognition Error]', event.error);
    };

    recognition.onend = () => {
      // CRITICAL: Do not restart recognition while Sage is speaking
      if (isSageSpeakingRef.current) {
        console.log('[useSpeech] Recognition ended but Sage is speaking - not restarting');
        return;
      }

      // Restart as long as we're still supposed to be listening.
      // On Android this fires after every utterance (continuous:false);
      // on desktop it fires only if recognition drops unexpectedly.
      if (isListeningRef.current) {
        try { recognition.start(); }
        catch (_) {
          if (isMobileRef.current) { isListeningRef.current = false; setStatus('idle'); }
        }
      }
    };

    recognitionRef.current = recognition;
    return () => { isListeningRef.current = false; recognition.abort(); clearSilenceTimer(); };
  }, [clearSilenceTimer, startSilenceTimer]);

  // ── Unlock audio (iOS audio session) ─────────
  const unlockAudio = useCallback(() => {
    if (audioRef.current) return;
    const audio = new Audio();
    audio.src =
      'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    audio.play().catch(() => {});
    audioRef.current = audio;
  }, []);

  // ── Shared post-audio handler ─────────────────
  const handleAudioEnded = useCallback((url: string) => {
    URL.revokeObjectURL(url);

    // Mark that Sage has finished speaking - this prevents speech recognition from
    // starting prematurely while TTS is still streaming or audio is playing
    isSageSpeakingRef.current = false;
    console.log('[useSpeech] Audio playback ended, Sage no longer speaking');

    onSpeakEndRef.current();

    // 300ms buffer to ensure audio has fully finished before enabling speech recognition
    const delay = 300;
    setTimeout(() => {
      // Double-check that Sage isn't speaking again (new question could have started)
      if (isSageSpeakingRef.current) {
        console.log('[useSpeech] Sage started speaking again, skipping speech recognition activation');
        return;
      }

      setStatus('listening');
      transcriptRef.current = '';
      setTranscript('');
      clearSilenceTimer();

      if (speechModeRef.current === 'webSpeech') {
        isListeningRef.current = true;
        try { recognitionRef.current?.start(); }
        catch (_) {
          if (isMobileRef.current) { isListeningRef.current = false; setStatus('idle'); }
          else console.error('[Recognition Start Error]', _);
        }
      } else {
        // MediaRecorder: auto-start fails on iOS (no user gesture) — fall to idle
        // so the "Tap to Answer" button appears.
        isListeningRef.current = false;
        setStatus('idle');
      }
    }, delay);
  }, [clearSilenceTimer]);

  // ── Internal: start MediaRecorder recording ───
  // Must be called from a user-gesture handler on iOS.
  async function startListeningMR() {
    // Yield to React so setStatus('listening') from startListening() renders
    // before we run any synchronous checks. Without this, React 18 batches
    // the listening→idle transition into one render and the UI appears frozen.
    await Promise.resolve();

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('Microphone unavailable. Make sure the app is served over HTTPS.');
      setStatus('idle');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err: any) {
      const msg = err?.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow mic access in your browser settings.'
        : `Microphone error: ${err?.message || err}`;
      setMicError(msg);
      setStatus('idle');
      return;
    }

    setMicError(''); // mic is working — clear any previous error

    audioStreamRef.current = stream;
    const mime     = mimeTypeRef.current;
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    mediaRecorderRef.current = recorder;
    audioChunksRef.current   = [];
    isListeningRef.current   = true;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      setIsRecording(false);
      stopAnalysis();
      stream.getTracks().forEach(t => t.stop());
      audioStreamRef.current = null;

      if (!isListeningRef.current) {
        // Cancelled
        audioChunksRef.current = [];
        return;
      }

      const blob = new Blob(audioChunksRef.current, { type: mime || 'audio/webm' });
      audioChunksRef.current = [];

      if (blob.size < 500) {
        setStatus('idle');
        return;
      }

      isListeningRef.current = false;
      setStatus('processing');

      try {
        const ext      = mime.includes('mp4') || mime.includes('m4a') ? 'm4a'
                       : mime.includes('ogg') ? 'ogg' : 'webm';
        const formData = new FormData();
        formData.append('audio', blob, `audio.${ext}`);

        const res  = await fetch('/api/stt', { method: 'POST', body: formData });
        const data = await res.json();
        const text = (data.transcript || '').trim();

        if (text) {
          setTranscript(text);
          onTranscriptRef.current(text);
        } else {
          setStatus('idle');
        }
      } catch (err) {
        console.error('[STT Error]', err);
        setStatus('idle');
      }
    };

    recorder.start(100);
    setIsRecording(true);
    setStatus('listening');

    // ── Optional silence detection via AudioContext ──
    // Wrapped in try/catch — if it fails on iOS, recording still works;
    // user submits manually via the "Done Speaking" button.
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const audioCtx = new AudioCtx();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const data      = new Uint8Array(analyser.frequencyBinCount);
      const THRESHOLD = 0.015;
      let hasSpeech   = false;
      let timerActive = false;

      analysisTimerRef.current = setInterval(() => {
        if (!isListeningRef.current || recorder.state !== 'recording') {
          stopAnalysis();
          audioCtx.close().catch(() => {});
          return;
        }
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const n = (data[i] - 128) / 128;
          sum += n * n;
        }
        const rms      = Math.sqrt(sum / data.length);
        const speaking = rms > THRESHOLD;

        if (speaking) {
          hasSpeech  = true;
          timerActive = false;
          clearSilenceTimer();
        } else if (hasSpeech && !timerActive) {
          timerActive = true;
          startMRSilenceTimer();
        }
      }, 100);
    } catch (_) {
      // AudioContext unavailable — silence detection skipped; manual stop only
    }
  }

  // ── speakBlob ─────────────────────────────────
  const speakBlob = useCallback((blob: Blob) => {
    const t0 = performance.now();
    console.log(`[TIMING] speakBlob: Called with blob size ${blob.size} bytes at ${t0.toFixed(2)}ms`);

    // Set flag immediately - Sage is now speaking, speech recognition MUST be disabled
    isSageSpeakingRef.current = true;
    console.log('[useSpeech] Sage started speaking, speech recognition disabled');

    setStatus('speaking');
    isListeningRef.current = false;

    // Stop any active speech recognition immediately
    try { recognitionRef.current?.abort(); } catch (_) {}
    if (mediaRecorderRef.current?.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch (_) {}
    }
    stopAnalysis();

    try {
      const url   = URL.createObjectURL(blob);
      const audio = audioRef.current || new Audio();
      audioRef.current = audio;
      audio.src = url;

      audio.onloadeddata = () => {
        const t1 = performance.now();
        console.log(`[TIMING] speakBlob: Audio loaded at ${t1.toFixed(2)}ms (+${(t1-t0).toFixed(2)}ms from speakBlob call)`);
      };

      audio.onplay = () => {
        const t2 = performance.now();
        console.log(`[TIMING] speakBlob: Audio STARTED PLAYING at ${t2.toFixed(2)}ms (+${(t2-t0).toFixed(2)}ms from speakBlob call)`);
      };

      audio.onended = () => handleAudioEnded(url);
      audio.onerror = () => {
        isSageSpeakingRef.current = false; // Clear flag on error
        URL.revokeObjectURL(url);
        setStatus('idle');
      };

      const t3 = performance.now();
      console.log(`[TIMING] speakBlob: Calling audio.play() at ${t3.toFixed(2)}ms (+${(t3-t0).toFixed(2)}ms)`);

      audio.play().catch(err => {
        console.error('[Audio play error]', err);
        isSageSpeakingRef.current = false; // Clear flag on error
        setStatus('idle');
      });
    } catch (err) {
      console.error('[speakBlob Error]', err);
      isSageSpeakingRef.current = false; // Clear flag on error
      setStatus('idle');
    }
  }, [handleAudioEnded, stopAnalysis]);

  // ── speak (TTS API) ───────────────────────────
  const speak = useCallback(async (text: string) => {
    // Set flag immediately - Sage is now speaking, speech recognition MUST be disabled
    isSageSpeakingRef.current = true;
    console.log('[useSpeech] Sage started speaking (TTS API), speech recognition disabled');

    setStatus('speaking');
    isListeningRef.current = false;

    // Stop any active speech recognition immediately
    try { recognitionRef.current?.abort(); } catch (_) {}
    if (mediaRecorderRef.current?.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch (_) {}
    }
    stopAnalysis();

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error('TTS request failed');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const audio = audioRef.current || new Audio();
      audioRef.current = audio;
      audio.src = url;
      audio.onended = () => handleAudioEnded(url);
      audio.onerror = () => {
        isSageSpeakingRef.current = false; // Clear flag on error
        URL.revokeObjectURL(url);
        setStatus('idle');
      };
      await audio.play();
    } catch (err) {
      console.error('[TTS Error]', err);
      isSageSpeakingRef.current = false; // Clear flag on error
      setStatus('idle');
    }
  }, [handleAudioEnded, stopAnalysis]);

  // ── startListening (public) ───────────────────
  const startListening = useCallback(() => {
    // CRITICAL: Do not start listening while Sage is speaking
    if (isSageSpeakingRef.current) {
      console.log('[useSpeech] Cannot start listening - Sage is currently speaking');
      return;
    }

    transcriptRef.current = '';
    setTranscript('');
    setStatus('listening');
    clearSilenceTimer();

    if (speechModeRef.current === 'mediaRecorder') {
      // Called from user-gesture button — safe for getUserMedia on iOS
      startListeningMR().catch(err => {
        console.error('[startListeningMR Error]', err);
        isListeningRef.current = false;
        setStatus('idle');
      });
      return;
    }

    // Web Speech path
    if (!recognitionRef.current) return;
    if (isMobileRef.current) {
      isListeningRef.current = false;
      try { recognitionRef.current.abort(); } catch (_) {}
      setTimeout(() => {
        isListeningRef.current = true;
        try { recognitionRef.current?.start(); }
        catch (_) { isListeningRef.current = false; setStatus('idle'); }
      }, 150);
    } else {
      isListeningRef.current = true;
      try { recognitionRef.current.start(); }
      catch (e) { console.error('[Recognition Start Error]', e); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearSilenceTimer]);

  // ── stopListening — manual submit for MediaRecorder mode ──
  // Called by the "Done Speaking" button on mobile.
  const stopListening = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      clearSilenceTimer();
      stopAnalysis();
      // isListeningRef stays true → onstop will process and send to Whisper
      try { mediaRecorderRef.current.stop(); } catch (_) {}
    }
  }, [clearSilenceTimer, stopAnalysis]);

  // ── Cancel everything ─────────────────────────
  const cancel = useCallback(() => {
    isListeningRef.current = false;
    isSageSpeakingRef.current = false; // Clear speaking flag
    setIsRecording(false);
    clearSilenceTimer();
    stopAnalysis();
    try { recognitionRef.current?.abort(); } catch (_) {}
    if (mediaRecorderRef.current?.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch (_) {}
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(t => t.stop());
      audioStreamRef.current = null;
    }
    audioChunksRef.current = [];
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    transcriptRef.current = '';
    setStatus('idle');
    setTranscript('');
  }, [clearSilenceTimer, stopAnalysis]);

  return {
    status,
    transcript,
    isSupported,
    silenceCountdown,
    speechMode,
    isRecording,
    micError,
    speak,
    speakBlob,
    startListening,
    stopListening,
    unlockAudio,
    cancel,
  };
}

import { useCallback, useEffect, useRef, useState } from 'react';

export type RealtimeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type AnswerQuality = 'strong' | 'medium' | 'weak' | 'incomplete';

export interface TopicArea {
  id: string;
  name: string;
  covered: boolean;
  score: number | null;
  questionCount: number;
}

export interface ExchangeRecord {
  areaId: string;
  question: string;
  answer: string;
  quality: AnswerQuality;
  score: number;
  feedback: string;
  timestamp: number;
}

interface UseRealtimeSessionOptions {
  onQuestionReceived?: (question: string) => void;
  onTranscriptUpdate?: (transcript: string) => void;
  onResponseStart?: () => void;
  onResponseEnd?: () => void;
  onError?: (error: string) => void;
  onInterviewComplete?: () => void;
}

export function useRealtimeSession(options: UseRealtimeSessionOptions = {}) {
  const [status, setStatus] = useState<RealtimeStatus>('disconnected');
  const [error, setError] = useState<string>('');
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [isSageSpeaking, setIsSageSpeaking] = useState(false);

  // Interview state
  const [topicAreas, setTopicAreas] = useState<TopicArea[]>([]);
  const [exchanges, setExchanges] = useState<ExchangeRecord[]>([]);
  const [currentAreaIndex, setCurrentAreaIndex] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track conversation state
  const conversationItemsRef = useRef<any[]>([]);
  const currentResponseTextRef = useRef('');
  const lastUserTranscriptRef = useRef('');
  const isEvaluatingRef = useRef(false);

  // ── Connect to Realtime API ──────────────────
  const connect = useCallback(async (systemPrompt?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[Realtime] Already connected');
      return;
    }

    setStatus('connecting');
    setError('');

    try {
      const t0 = performance.now();
      console.log(`[TIMING] Realtime: Fetching session token at ${t0.toFixed(2)}ms`);

      // Get ephemeral session token
      const res = await fetch('/api/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        throw new Error('Failed to create session');
      }

      const { clientSecret } = await res.json();
      if (!clientSecret) {
        throw new Error('No session token received');
      }

      const t1 = performance.now();
      console.log(`[TIMING] Realtime: Session token received at ${t1.toFixed(2)}ms (+${(t1-t0).toFixed(2)}ms)`);
      console.log(`[Realtime] Client secret token: ${clientSecret.substring(0, 20)}...${clientSecret.substring(clientSecret.length - 20)}`);

      // Construct WebSocket URL with model parameter
      const wsUrl = `wss://api.openai.com/v1/realtime?model=gpt-realtime-1.5`;

      // Browser WebSocket doesn't support custom headers, so we pass the ephemeral token
      // via the WebSocket subprotocol array (second argument to WebSocket constructor)
      const protocols = [
        "realtime",
        "openai-insecure-api-key." + clientSecret,
        "openai-beta.realtime-v1"
      ];

      console.log(`[Realtime] WebSocket URL: ${wsUrl}`);
      console.log(`[Realtime] Using subprotocols for authentication`);
      console.log(`[Realtime] Creating WebSocket connection...`);

      const ws = new WebSocket(wsUrl, protocols);
      ws.binaryType = 'arraybuffer';
      console.log(`[Realtime] WebSocket created, initial readyState:`, ws.readyState, '(0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)');

      // Set a connection timeout
      connectionTimeoutRef.current = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.error('[Realtime] Connection timeout - WebSocket did not open within 10 seconds');
          console.error('[Realtime] Current readyState:', ws.readyState);
          ws.close();
          setStatus('error');
          setError('Connection timeout - check your API key and model access');
          options.onError?.('Connection timeout');
        }
      }, 10000);

      ws.onopen = () => {
        const t2 = performance.now();
        console.log(`[TIMING] Realtime: WebSocket connected at ${t2.toFixed(2)}ms (+${(t2-t1).toFixed(2)}ms)`);

        // Clear connection timeout
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }

        setStatus('connected');

        // Send session update to configure audio format and voice
        const sessionConfig: any = {
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            voice: 'verse',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 700,
            },
            temperature: 0.8,
            max_response_output_tokens: 4096,
          },
        };

        // If system prompt provided, add it to the session config
        if (systemPrompt) {
          sessionConfig.session.instructions = systemPrompt;
        }

        ws.send(JSON.stringify(sessionConfig));
        console.log('[Realtime] Session configured');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleRealtimeMessage(message);
        } catch (err) {
          console.error('[Realtime] Failed to parse message:', err);
        }
      };

      ws.onerror = (event: Event) => {
        console.error('[Realtime] WebSocket error event:', event);
        setStatus('error');
        setError('Connection error - check console for details');
        options.onError?.('Connection error');
      };

      ws.onclose = (event: CloseEvent) => {
        console.log('[Realtime] WebSocket closed');
        console.log('[Realtime] Close code:', event.code);
        console.log('[Realtime] Close reason:', event.reason);
        console.log('[Realtime] Clean close:', event.wasClean);

        // Clear connection timeout
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }

        if (!event.wasClean) {
          const errorMessage = `Connection closed unexpectedly (code: ${event.code})${event.reason ? ': ' + event.reason : ''}`;
          console.error('[Realtime]', errorMessage);
          setError(errorMessage);
        }

        setStatus('disconnected');
        stopAudioCapture();
      };

      wsRef.current = ws;

    } catch (err: any) {
      console.error('[Realtime] Connection failed:', err);
      setStatus('error');
      setError(err.message || 'Failed to connect');
      options.onError?.(err.message || 'Failed to connect');
    }
  }, [options]);

  // ── Handle incoming Realtime API messages ────
  const handleRealtimeMessage = useCallback((message: any) => {
    const type = message.type;

    switch (type) {
      case 'session.created':
      case 'session.updated':
        console.log(`[Realtime] ${type}`);
        break;

      case 'conversation.item.created':
        console.log('[Realtime] Conversation item created:', message.item.type);
        conversationItemsRef.current.push(message.item);

        // If this is an assistant message, extract the text content
        if (message.item.role === 'assistant' && message.item.type === 'message') {
          const textContent = message.item.content?.find((c: any) => c.type === 'text');
          if (textContent?.text) {
            const questionText = textContent.text;
            setCurrentQuestion(questionText);
            console.log('[Realtime] Question received:', questionText);
            options.onQuestionReceived?.(questionText);
          }
        }
        break;

      case 'response.created':
        console.log('[Realtime] Response created');
        currentResponseTextRef.current = '';
        setIsSageSpeaking(true);
        options.onResponseStart?.();
        break;

      case 'response.output_item.added':
        console.log('[Realtime] Response output item added');
        break;

      case 'response.content_part.added':
        console.log('[Realtime] Response content part added');
        break;

      case 'response.text.delta':
        // Accumulate response text as it streams
        if (message.delta) {
          currentResponseTextRef.current += message.delta;
        }
        break;

      case 'response.text.done':
        // Final text of the response
        if (message.text) {
          currentResponseTextRef.current = message.text;
          setCurrentQuestion(message.text);
          console.log('[Realtime] Complete question text:', message.text);
          options.onQuestionReceived?.(message.text);
        }
        break;

      case 'response.audio.delta':
        // Audio chunk from the model - base64 encoded PCM16
        if (message.delta) {
          playAudioDelta(message.delta);
        }
        break;

      case 'response.audio.done':
        console.log('[Realtime] Audio response complete');
        break;

      case 'response.done':
        console.log('[Realtime] Response complete');
        setIsSageSpeaking(false);
        options.onResponseEnd?.();
        break;

      case 'input_audio_buffer.speech_started':
        console.log('[Realtime] User started speaking');
        setCurrentTranscript('');
        lastUserTranscriptRef.current = '';
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('[Realtime] User stopped speaking');
        // The transcript should already be captured from conversation.item.input_audio_transcription.completed
        break;

      case 'conversation.item.input_audio_transcription.completed':
        // User's speech has been transcribed
        const transcript = message.transcript?.trim();
        if (transcript) {
          console.log('[Realtime] User transcript:', transcript);
          lastUserTranscriptRef.current = transcript;
          setCurrentTranscript(transcript);
          options.onTranscriptUpdate?.(transcript);

          // Trigger background evaluation
          if (!isEvaluatingRef.current && currentQuestion) {
            evaluateAnswer(transcript);
          }
        }
        break;

      case 'error':
        console.error('[Realtime] Error from API:', message.error);
        setError(message.error.message || 'API error');
        options.onError?.(message.error.message || 'API error');
        break;

      default:
        // Log other events at debug level
        if (type && !type.includes('heartbeat')) {
          console.log(`[Realtime] Event: ${type}`);
        }
    }
  }, [options, currentQuestion]);

  // ── Evaluate answer in background ────────────
  const evaluateAnswer = useCallback(async (answerText: string) => {
    if (isEvaluatingRef.current || !currentQuestion) return;

    isEvaluatingRef.current = true;
    const t0 = performance.now();
    console.log(`[Realtime] Starting background evaluation at ${t0.toFixed(2)}ms`);

    try {
      const currentArea = topicAreas[currentAreaIndex];

      const res = await fetch('/api/realtime/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: currentQuestion,
          answer: answerText,
          topic: currentArea?.name || 'General',
          areaName: currentArea?.name || 'General',
          experienceLevel: 'mid-level', // This should come from interview config
        }),
      });

      const evaluation = await res.json();

      const t1 = performance.now();
      console.log(`[Realtime] Evaluation complete at ${t1.toFixed(2)}ms (+${(t1-t0).toFixed(2)}ms)`);
      console.log('[Realtime] Evaluation result:', evaluation.quality, evaluation.score);

      // Store the exchange
      if (evaluation.quality !== 'incomplete' && currentArea) {
        const newExchange: ExchangeRecord = {
          areaId: currentArea.id,
          question: currentQuestion,
          answer: answerText,
          quality: evaluation.quality,
          score: evaluation.score,
          feedback: evaluation.feedback,
          timestamp: Date.now(),
        };

        setExchanges(prev => [...prev, newExchange]);

        // Update area score
        setTopicAreas(prev => prev.map((area, idx) =>
          idx === currentAreaIndex
            ? { ...area, score: evaluation.score }
            : area
        ));
      }

    } catch (err) {
      console.error('[Realtime] Evaluation error:', err);
    } finally {
      isEvaluatingRef.current = false;
    }
  }, [currentQuestion, topicAreas, currentAreaIndex]);

  // ── Play audio delta from the model ──────────
  const playAudioDelta = useCallback((base64Audio: string) => {
    try {
      // Decode base64 to PCM16
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert to Int16Array (PCM16)
      const pcm16 = new Int16Array(bytes.buffer);
      audioQueueRef.current.push(pcm16);

      // Start playback if not already playing
      if (!isPlayingRef.current) {
        isPlayingRef.current = true;
        playAudioQueue();
      }
    } catch (err) {
      console.error('[Realtime] Failed to decode audio:', err);
    }
  }, []);

  // ── Play queued audio chunks ─────────────────
  const playAudioQueue = useCallback(async () => {
    const audioContext = audioContextRef.current || new AudioContext({ sampleRate: 24000 });
    audioContextRef.current = audioContext;

    while (audioQueueRef.current.length > 0) {
      const pcm16 = audioQueueRef.current.shift()!;

      // Convert PCM16 to Float32 for Web Audio API
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }

      // Create audio buffer
      const audioBuffer = audioContext.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      // Create source and play
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start();

      // Wait for this chunk to finish before playing the next
      await new Promise(resolve => {
        source.onended = resolve;
      });
    }

    isPlayingRef.current = false;
  }, []);

  // ── Start capturing and streaming microphone audio ──
  const startAudioCapture = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('[Realtime] Cannot start audio capture - WebSocket not connected');
      return;
    }

    try {
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 24000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      mediaStreamRef.current = stream;

      // Create audio context and processor
      const audioContext = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);

        // Convert Float32 to PCM16
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Convert to base64
        const bytes = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        // Send to Realtime API
        wsRef.current.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: base64,
        }));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      console.log('[Realtime] Audio capture started');

    } catch (err) {
      console.error('[Realtime] Failed to start audio capture:', err);
      setError('Microphone access denied');
      options.onError?.('Microphone access denied');
    }
  }, [options]);

  // ── Stop audio capture ───────────────────────
  const stopAudioCapture = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    console.log('[Realtime] Audio capture stopped');
  }, []);

  // ── Initialize interview with topic areas ────
  const initializeInterview = useCallback((areas: TopicArea[]) => {
    // Ensure areas have questionCount property
    const areasWithCount = areas.map(a => ({
      ...a,
      questionCount: a.questionCount || 0,
    }));
    setTopicAreas(areasWithCount);
    setCurrentAreaIndex(0);
    setExchanges([]);
    setCurrentQuestion('');
    setCurrentTranscript('');
  }, []);

  // ── Disconnect ───────────────────────────────
  const disconnect = useCallback(() => {
    stopAudioCapture();

    // Clear connection timeout
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setStatus('disconnected');
    setError('');
  }, [stopAudioCapture]);

  // ── Cleanup on unmount ───────────────────────
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    error,
    isSageSpeaking,
    currentTranscript,
    currentQuestion,
    topicAreas,
    exchanges,
    currentAreaIndex,
    connect,
    disconnect,
    startAudioCapture,
    stopAudioCapture,
    initializeInterview,
  };
}

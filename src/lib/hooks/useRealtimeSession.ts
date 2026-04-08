import { useCallback, useEffect, useRef, useState } from 'react';

export type RealtimeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface UseRealtimeSessionOptions {
  onResponseStart?: () => void;
  onResponseEnd?: () => void;
  onError?: (error: string) => void;
}

export function useRealtimeSession(options: UseRealtimeSessionOptions = {}) {
  const [status, setStatus] = useState<RealtimeStatus>('disconnected');
  const [error, setError] = useState<string>('');

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);
  const connectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Connect to Realtime API ──────────────────
  const connect = useCallback(async () => {
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
      console.log(`[Realtime] Using subprotocols for authentication: realtime, openai-insecure-api-key.[token], openai-beta.realtime-v1`);
      console.log(`[Realtime] Creating WebSocket connection...`);

      const ws = new WebSocket(wsUrl, protocols);
      ws.binaryType = 'arraybuffer';
      console.log(`[Realtime] WebSocket created, initial readyState:`, ws.readyState, '(0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)');

      // Set a connection timeout
      connectionTimeoutRef.current = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.error('[Realtime] Connection timeout - WebSocket did not open within 10 seconds');
          console.error('[Realtime] Current readyState:', ws.readyState, {
            0: 'CONNECTING',
            1: 'OPEN',
            2: 'CLOSING',
            3: 'CLOSED'
          }[ws.readyState]);
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

        // Send session update to configure audio format
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: 'You are a helpful assistant conducting an interview. Keep responses brief and conversational.',
            voice: 'verse',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
          },
        }));
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
        console.error('[Realtime] Error type:', event.type);
        console.error('[Realtime] Error target:', event.target);
        if (event instanceof ErrorEvent) {
          console.error('[Realtime] Error message:', event.message);
          console.error('[Realtime] Error filename:', event.filename);
          console.error('[Realtime] Error lineno:', event.lineno);
        }
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

        let errorMessage = '';
        if (!event.wasClean) {
          errorMessage = `Connection closed unexpectedly (code: ${event.code})`;
          if (event.reason) {
            errorMessage += `: ${event.reason}`;
          }

          // Common WebSocket close codes
          const closeCodeMeanings: Record<number, string> = {
            1000: 'Normal closure',
            1001: 'Going away',
            1002: 'Protocol error',
            1003: 'Unsupported data',
            1006: 'Abnormal closure (no close frame)',
            1007: 'Invalid frame payload data',
            1008: 'Policy violation',
            1009: 'Message too big',
            1010: 'Missing extension',
            1011: 'Internal server error',
            1015: 'TLS handshake failure',
          };

          const meaning = closeCodeMeanings[event.code] || 'Unknown error';
          console.error('[Realtime]', errorMessage, '-', meaning);
          setError(`${errorMessage} (${meaning})`);
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
    console.log('[Realtime] Received:', message.type);

    switch (message.type) {
      case 'session.created':
        console.log('[Realtime] Session created:', message.session);
        break;

      case 'session.updated':
        console.log('[Realtime] Session updated');
        break;

      case 'response.audio.delta':
        // Audio chunk from the model - base64 encoded PCM16
        if (message.delta) {
          playAudioDelta(message.delta);
        }
        break;

      case 'response.audio.done':
        console.log('[Realtime] Audio response complete');
        options.onResponseEnd?.();
        break;

      case 'response.done':
        console.log('[Realtime] Response complete');
        break;

      case 'input_audio_buffer.speech_started':
        console.log('[Realtime] User started speaking');
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('[Realtime] User stopped speaking');
        break;

      case 'conversation.item.created':
        console.log('[Realtime] Conversation item created');
        break;

      case 'error':
        console.error('[Realtime] Error from API:', message.error);
        setError(message.error.message || 'API error');
        options.onError?.(message.error.message || 'API error');
        break;

      default:
        // Log other events for debugging
        if (message.type) {
          console.log(`[Realtime] Unhandled event: ${message.type}`);
        }
    }
  }, [options]);

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
        options.onResponseStart?.();
        playAudioQueue();
      }
    } catch (err) {
      console.error('[Realtime] Failed to decode audio:', err);
    }
  }, [options]);

  // ── Play queued audio chunks ─────────────────
  const playAudioQueue = useCallback(async () => {
    const audioContext = audioContextRef.current || new AudioContext({ sampleRate: 24000 });
    audioContextRef.current = audioContext;

    while (audioQueueRef.current.length > 0) {
      const pcm16 = audioQueueRef.current.shift()!;

      // Convert PCM16 to Float32 for Web Audio API
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0; // Convert to -1.0 to 1.0 range
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
    connect,
    disconnect,
    startAudioCapture,
    stopAudioCapture,
  };
}

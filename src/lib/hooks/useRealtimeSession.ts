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
  onSessionReady?: () => void;
}

export function useRealtimeSession(options: UseRealtimeSessionOptions = {}) {
  const [status, setStatus] = useState<RealtimeStatus>('disconnected');
  const [error, setError] = useState<string>('');
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [isSageSpeaking, setIsSageSpeaking] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);

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
  const currentUserTranscriptRef = useRef('');
  const lastUserTranscriptRef = useRef('');
  const isEvaluatingRef = useRef(false);
  const sessionReadyResolveRef = useRef<(() => void) | null>(null);
  const pendingDisconnectRef = useRef(false);
  const exchangesRef = useRef<ExchangeRecord[]>([]);
  const topicAreasRef = useRef<TopicArea[]>([]);
  const currentAreaIndexRef = useRef(0);
  const handleRealtimeMessageRef = useRef<((message: any) => void) | null>(null);
  const currentQuestionRef = useRef('');
  const isSageSpeakingRef = useRef(false);
  const echoGracePeriodRef = useRef(false); // Mobile: block speech detection for a grace period after audio ends

  // ── Connect to Realtime API ──────────────────
  const connect = useCallback(async (systemPrompt?: string): Promise<void> => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[Realtime] Already connected');
      return;
    }

    setStatus('connecting');
    setError('');

    // Create a promise that resolves when session is fully configured
    const sessionReadyPromise = new Promise<void>((resolve) => {
      sessionReadyResolveRef.current = resolve;
    });

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

        // Detect mobile for optimized VAD settings
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

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
              threshold: isMobile ? 0.6 : 0.5, // Higher threshold on mobile to reduce false positives
              prefix_padding_ms: 300,
              silence_duration_ms: isMobile ? 3000 : 2500, // Longer silence on mobile to avoid cutting off
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
          // Use ref to always call the latest handler
          handleRealtimeMessageRef.current?.(message);
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

      // Wait for session to be fully configured before resolving
      console.log('[Realtime] Waiting for session.updated confirmation...');
      await sessionReadyPromise;
      console.log('[Realtime] Session fully configured and ready');

    } catch (err: any) {
      console.error('[Realtime] Connection failed:', err);
      setStatus('error');
      setError(err.message || 'Failed to connect');
      options.onError?.(err.message || 'Failed to connect');

      // Reject the session ready promise if it's still pending
      if (sessionReadyResolveRef.current) {
        sessionReadyResolveRef.current();
        sessionReadyResolveRef.current = null;
      }
    }
  }, [options]);

  // ── Handle incoming Realtime API messages ────
  const handleRealtimeMessage = useCallback((message: any) => {
    const type = message.type;

    switch (type) {
      case 'session.created':
        console.log(`[Realtime] ${type}`);
        break;

      case 'session.updated':
        console.log(`[Realtime] ${type} - Session fully configured`);
        // Resolve the session ready promise
        if (sessionReadyResolveRef.current) {
          sessionReadyResolveRef.current();
          sessionReadyResolveRef.current = null;
        }
        // Trigger the assistant to speak first (based on system instructions)
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          console.log('[Realtime] Triggering assistant to begin interview');
          wsRef.current.send(JSON.stringify({
            type: 'response.create',
          }));
        }
        // Notify that session is ready
        options.onSessionReady?.();
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
        setCurrentQuestion(''); // Clear previous question text
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
        console.log('[Realtime] Audio response complete - waiting for playback to finish...');

        // Wait for audio queue to finish playing before marking Sage as done speaking
        // This prevents microphone from picking up tail-end audio as user speech
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds max
        const checkInterval = setInterval(() => {
          attempts++;
          const queueEmpty = audioQueueRef.current.length === 0;
          const notPlaying = !isPlayingRef.current;

          if ((queueEmpty && notPlaying) || attempts >= maxAttempts) {
            clearInterval(checkInterval);
            console.log('[Realtime] ✅ Audio playback complete');

            // Detect mobile for extended echo grace period
            const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

            // Mark Sage as not speaking
            setIsSageSpeaking(false);
            options.onResponseEnd?.();

            // MOBILE FIX: Add grace period to block echo pickup after audio finishes
            // Mobile devices have worse acoustic isolation - speakers bleed into mic
            if (isMobile) {
              echoGracePeriodRef.current = true;
              console.log('[Realtime] 🔇 Mobile: Starting 800ms echo grace period');

              // Clear any audio in the buffer that might be echo
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
              }

              setTimeout(() => {
                echoGracePeriodRef.current = false;
                console.log('[Realtime] 🔊 Mobile: Echo grace period ended, ready for user input');
              }, 800); // 800ms grace period on mobile
            }

            // If conclusion was detected, trigger interview completion and disconnect
            if (pendingDisconnectRef.current) {
              console.log('[Realtime] 🎯 Triggering interview completion after full audio playback');
              options.onInterviewComplete?.();

              stopAudioCapture();
              if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
              }
              setStatus('disconnected');
              pendingDisconnectRef.current = false;
            }
          }
        }, 100);
        break;

      case 'response.audio_transcript.delta':
        // Transcript of audio being spoken - stream it to display
        if (message.delta) {
          currentResponseTextRef.current += message.delta;
          const displayText = currentResponseTextRef.current;
          setCurrentQuestion(displayText);
          console.log('[Realtime] Audio transcript delta:', message.delta);
        }
        break;

      case 'response.audio_transcript.done':
        // Final transcript of audio spoken
        if (message.transcript) {
          currentResponseTextRef.current = message.transcript;
          setCurrentQuestion(message.transcript);

          // Log every response to debug conclusion detection
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('[Realtime] SAGE RESPONSE:', message.transcript);
          console.log('[Realtime] Current exchanges:', exchangesRef.current.length);
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

          options.onQuestionReceived?.(message.transcript);

          // Check for conclusion signals - broader pattern matching
          const lowerTranscript = message.transcript.toLowerCase();
          const conclusionSignals = [
            'goodbye',
            'take care',
            'interview is finished',
            'interview is complete',
            'our interview is finished',
            'our interview is complete',
            'best of luck',
            'good luck',
            'that concludes',
            "we're done",
            'thank you for your time',
            'that wraps up',
            'thanks for your time',
            'appreciate your time',
            'wraps up our interview',
          ];
          const isConclusion = conclusionSignals.some(signal => lowerTranscript.includes(signal));

          // Safety fallback: auto-conclude only after 12+ exchanges as absolute safety net
          // This should rarely fire - Sage should conclude naturally
          const totalExchanges = exchangesRef.current.length;
          const shouldAutoAbort = totalExchanges >= 12;

          if (isConclusion || shouldAutoAbort) {
            const reason = isConclusion
              ? 'Conclusion signal detected'
              : `${totalExchanges} exchanges - absolute safety limit reached (auto-abort)`;
            console.log(`[Realtime] 🎯 ${reason} - WILL DISCONNECT AFTER AUDIO FULLY PLAYS`);

            // Set flag to trigger completion after audio finishes playing
            // onInterviewComplete will be called in response.audio.done handler
            pendingDisconnectRef.current = true;
          } else if (isConclusion && totalExchanges < 3) {
            console.warn('[Realtime] ⚠️ Conclusion signal detected but only', totalExchanges, 'exchanges - continuing interview');
          }
        }
        break;

      case 'response.done':
        console.log('[Realtime] Response generation complete (audio may still be playing)');
        // NOTE: Do NOT set isSageSpeaking = false here
        // Audio is still playing from the queue - wait for response.audio.done
        break;

      case 'input_audio_buffer.speech_started':
        // Ignore false positives when Sage is speaking (detecting her own audio output)
        if (isSageSpeakingRef.current) {
          console.warn('[Realtime] ⚠️ BLOCKING echo - Sage is speaking, ignoring false speech detection');
          // Cancel the input audio buffer to discard the echo audio
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
            console.log('[Realtime] Sent input_audio_buffer.clear to discard echo');
          }
          return;
        }

        // MOBILE FIX: Block speech detection during grace period after audio ends
        // This prevents picking up residual echo/room reverb from speakers
        if (echoGracePeriodRef.current) {
          console.warn('[Realtime] ⚠️ BLOCKING echo - Mobile grace period active, ignoring speech detection');
          // Clear the audio buffer to discard residual echo
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
            console.log('[Realtime] Sent input_audio_buffer.clear during mobile grace period');
          }
          return;
        }

        console.log('[Realtime] User started speaking');
        currentUserTranscriptRef.current = '';
        setCurrentTranscript('');
        setIsUserSpeaking(true);
        options.onTranscriptUpdate?.('');
        break;

      case 'input_audio_buffer.speech_stopped':
        // Ignore if we ignored the corresponding speech_started event
        if (isSageSpeakingRef.current || echoGracePeriodRef.current) {
          console.warn('[Realtime] ⚠️ Ignoring speech_stopped - was a false positive');
          return;
        }

        console.log('[Realtime] User stopped speaking - waiting for transcription');
        setIsUserSpeaking(false);
        // The transcript should already be captured from conversation.item.input_audio_transcription.completed
        break;

      case 'input_audio_buffer.committed':
        // Ignore buffer commits that happen while Sage is speaking or during grace period
        if (isSageSpeakingRef.current || echoGracePeriodRef.current) {
          console.warn('[Realtime] ⚠️ Ignoring buffer commit - Sage is speaking or grace period active (false positive)');
          return;
        }
        console.log('[Realtime] Audio buffer committed');
        break;

      case 'conversation.item.input_audio_transcription.delta':
        // Ignore transcript deltas while Sage is speaking or during mobile grace period
        if (isSageSpeakingRef.current || echoGracePeriodRef.current) {
          return;
        }

        // User's speech is being transcribed in real-time - stream it to display
        if (message.delta) {
          currentUserTranscriptRef.current += message.delta;
          const displayTranscript = currentUserTranscriptRef.current.trim();
          setCurrentTranscript(displayTranscript);
          console.log('[Realtime] User transcript delta, total so far:', displayTranscript);
        }
        break;

      case 'conversation.item.input_audio_transcription.completed':
        // User's speech has been transcribed completely
        // NOTE: This event fires DURING Sage's response (normal API behavior)
        // The user spoke, then Sage started responding, then this transcript arrives
        // Do NOT ignore it just because Sage is currently speaking

        // MOBILE FIX: Block transcripts during grace period (these are echo from just-finished audio)
        if (echoGracePeriodRef.current) {
          console.warn('[Realtime] ⚠️ Ignoring transcript during mobile grace period - likely echo');
          return;
        }

        const transcript = message.transcript?.trim();
        if (transcript) {
          console.log('[Realtime] User transcript complete:', transcript);

          // Validate transcript to filter hallucinations and mishears
          const wordCount = transcript.split(/\s+/).filter(Boolean).length;
          const lowerTranscript = transcript.toLowerCase();

          // Detect mobile device for stricter filtering
          const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

          // Known hallucination patterns from background noise (expanded list)
          const hallucinationPatterns = [
            'thank you for watching',
            'thanks for watching',
            'bye bye',
            'goodbye',
            'see you',
            'take care',
            'have a good day',
            'have a nice day',
            'you for your',
            'thank you',
            'thanks',
            'please subscribe',
            'like and subscribe',
            'музыка', // Music in various languages
            'music',
            'subtitles',
            'captions',
          ];

          const isHallucination = hallucinationPatterns.some(pattern =>
            lowerTranscript.includes(pattern)
          );

          // Mobile: require at least 6 words to reduce false positives from noise
          // Desktop: require at least 4 words
          const minWords = isMobile ? 6 : 4;
          const isTooShort = wordCount < minWords;

          // Check for repeated words (gibberish detection)
          const words = transcript.split(/\s+/).filter(Boolean);
          const uniqueWords = new Set(words.map((w: string) => w.toLowerCase()));
          const repetitionRatio = uniqueWords.size / words.length;
          const isGibberish = wordCount >= 3 && repetitionRatio < 0.6; // More than 40% repeated words

          // Check if transcript is just filler words
          const fillerWords = ['um', 'uh', 'like', 'you know', 'i mean', 'so', 'well'];
          const isOnlyFiller = words.every((w: string) => fillerWords.includes(w.toLowerCase()));

          if (isTooShort || isHallucination || isGibberish || isOnlyFiller) {
            const reason = isTooShort ? `Too short (< ${minWords} words)`
                         : isGibberish ? 'Gibberish/repeated words detected'
                         : isOnlyFiller ? 'Only filler words'
                         : 'Hallucination pattern detected';
            console.warn(`[Realtime] ⚠️ Discarding invalid transcript (${wordCount} words):`, transcript);
            console.warn('[Realtime] Reason:', reason);
            // Clear the transcript and wait for user to speak again
            currentUserTranscriptRef.current = '';
            setCurrentTranscript('');
            return;
          }

          currentUserTranscriptRef.current = transcript;
          lastUserTranscriptRef.current = transcript;
          setCurrentTranscript(transcript);
          options.onTranscriptUpdate?.(transcript);

          // Immediately create exchange record when answer completes
          if (currentQuestionRef.current) {
            const currentArea = topicAreasRef.current[currentAreaIndexRef.current];
            const newExchange: ExchangeRecord = {
              areaId: currentArea?.id || 'unknown',
              question: currentQuestionRef.current,
              answer: transcript,
              quality: 'medium', // Placeholder - will be updated by evaluation
              score: 0, // Placeholder - will be updated by evaluation
              feedback: '', // Placeholder - will be updated by evaluation
              timestamp: Date.now(),
            };

            setExchanges(prev => {
              const updated = [...prev, newExchange];
              console.log('[Realtime] Exchange added - Total exchanges:', updated.length);
              console.log('[Realtime] Current area:', currentArea?.name, 'ID:', currentArea?.id);
              return updated;
            });

            // Increment question count for current area and check if we should advance
            setTopicAreas(prev => {
              const updated = prev.map((area, idx) =>
                idx === currentAreaIndexRef.current
                  ? { ...area, questionCount: (area.questionCount || 0) + 1 }
                  : area
              );
              return updated;
            });

            // Check if we should advance to the next topic area
            const currentQuestionCount = (currentArea?.questionCount || 0) + 1;
            const hasMoreAreas = currentAreaIndexRef.current < topicAreasRef.current.length - 1;
            const shouldAdvance = currentQuestionCount >= 2 && hasMoreAreas;

            if (shouldAdvance) {
              console.log(`[Realtime] 📍 Advancing from area "${currentArea?.name}" (${currentQuestionCount} questions) to next area`);

              // Mark current area as covered when advancing
              setTopicAreas(prev => prev.map((area, idx) =>
                idx === currentAreaIndexRef.current
                  ? { ...area, covered: true }
                  : area
              ));

              setCurrentAreaIndex(prev => prev + 1);
            }

            console.log('[Realtime] Exchange created:', newExchange);
          }

          // Trigger background evaluation
          if (!isEvaluatingRef.current && currentQuestionRef.current) {
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
        // Log other events at debug level to help identify missing handlers
        if (type && !type.includes('heartbeat') && !type.includes('rate_limits')) {
          console.log(`[Realtime] Unhandled event: ${type}`, message);
        }
    }
  }, [options]);

  // ── Evaluate answer in background ────────────
  const evaluateAnswer = useCallback(async (answerText: string) => {
    if (isEvaluatingRef.current || !currentQuestionRef.current) return;

    isEvaluatingRef.current = true;
    const t0 = performance.now();
    console.log(`[Realtime] Starting background evaluation at ${t0.toFixed(2)}ms`);

    try {
      const currentArea = topicAreasRef.current[currentAreaIndexRef.current];

      const res = await fetch('/api/realtime/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: currentQuestionRef.current,
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

      // Update the most recent exchange with evaluation results
      if (evaluation.quality !== 'incomplete' && currentArea) {
        setExchanges(prev => {
          const updated = [...prev];
          const lastExchange = updated[updated.length - 1];
          if (lastExchange && lastExchange.answer === answerText) {
            lastExchange.quality = evaluation.quality;
            lastExchange.score = evaluation.score;
            lastExchange.feedback = evaluation.feedback;
          }
          return updated;
        });

        // Update area score
        setTopicAreas(prev => prev.map((area, idx) =>
          idx === currentAreaIndexRef.current
            ? { ...area, score: evaluation.score }
            : area
        ));
      }

    } catch (err) {
      console.error('[Realtime] Evaluation error:', err);
    } finally {
      isEvaluatingRef.current = false;
    }
  }, []);

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
      // Detect mobile device
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

      // Get microphone access with echo cancellation
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 24000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: isMobile, // Enable AGC on mobile to normalize levels and reduce noise
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

  // ── Keep refs in sync with state ──────────────
  useEffect(() => {
    exchangesRef.current = exchanges;
  }, [exchanges]);

  useEffect(() => {
    topicAreasRef.current = topicAreas;
  }, [topicAreas]);

  useEffect(() => {
    currentQuestionRef.current = currentQuestion;
  }, [currentQuestion]);

  useEffect(() => {
    currentAreaIndexRef.current = currentAreaIndex;
  }, [currentAreaIndex]);

  useEffect(() => {
    isSageSpeakingRef.current = isSageSpeaking;
  }, [isSageSpeaking]);

  useEffect(() => {
    handleRealtimeMessageRef.current = handleRealtimeMessage;
  }, [handleRealtimeMessage]);

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
    connect,
    disconnect,
    startAudioCapture,
    stopAudioCapture,
    initializeInterview,
  };
}

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import {
  initializeSession,
  generateQuestion,
  evaluateAnswer,
  decideNextStep,
  concludeSession,
} from '@/lib/agent/graph';
import type { ExaminerState, ExchangeRecord } from '@/lib/agent/types';
import { checkRateLimit } from '@/lib/rateLimit';

const isValidField = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.trim().length < 100;

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!checkRateLimit(userId)) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again in a minute.' }, { status: 429 });
  }

  try {
    const t0 = Date.now();
    console.log(`[TIMING] Agent API: Request received at ${t0}`);

    const body = await req.json();
    const { action } = body;

    // ── ACTION: warmup ─────────────────────────
    if (action === 'warmup') {
      const t1 = Date.now();
      console.log(`[TIMING] Agent API: Warmup complete at ${t1} (+${t1-t0}ms)`);
      return NextResponse.json({ success: true, warmed: true });
    }

    // ── ACTION: start ──────────────────────────
    if (action === 'start') {
      const t1 = Date.now();
      console.log(`[TIMING] Agent API: Action=start, parsed at ${t1} (+${t1-t0}ms)`);

      const { topic, role, experienceLevel, interviewType } = body;
      if (!isValidField(topic)) {
        return NextResponse.json({ error: 'Topic is required and must be under 100 characters' }, { status: 400 });
      }
      if (role !== undefined && !isValidField(role)) {
        return NextResponse.json({ error: 'Role must be a non-empty string under 100 characters' }, { status: 400 });
      }
      const validLevels = ['junior', 'mid-level', 'senior'];
      if (experienceLevel !== undefined && !validLevels.includes(experienceLevel)) {
        return NextResponse.json({ error: 'Invalid experienceLevel' }, { status: 400 });
      }
      const validTypes = ['behavioral', 'technical', 'mixed'];
      if (interviewType !== undefined && !validTypes.includes(interviewType)) {
        return NextResponse.json({ error: 'Invalid interviewType' }, { status: 400 });
      }

      // Step 1: break topic into areas
      const t2 = Date.now();
      console.log(`[TIMING] Agent API: Calling initializeSession at ${t2} (+${t2-t1}ms)`);

      const topicAreas = await initializeSession(topic.trim());

      const t3 = Date.now();
      console.log(`[TIMING] Agent API: initializeSession done at ${t3} (+${t3-t2}ms)`);

      // Build initial state
      const state: ExaminerState = {
        topic: topic.trim(),
        role: role || topic.trim(),
        experienceLevel: experienceLevel || 'mid-level',
        interviewType: interviewType || 'mixed',
        sessionId: crypto.randomUUID(),
        topicAreas,
        currentAreaIndex: 0,
        currentQuestion: '',
        currentAnswer: '',
        currentQuality: null,
        currentFeedback: '',
        exchanges: [],
        phase: 'generating_question',
        nextNode: 'generate',
        followUpCount: 0,
        finalEvaluation: null,
        overallScore: null,
        error: null,
      };

      // Step 2: generate first question
      const t4 = Date.now();
      console.log(`[TIMING] Agent API: Calling generateQuestion at ${t4} (+${t4-t3}ms)`);

      const question = await generateQuestion(state);

      const t5 = Date.now();
      console.log(`[TIMING] Agent API: generateQuestion done at ${t5} (+${t5-t4}ms). Question: "${question.substring(0, 50)}..."`);

      state.currentQuestion = question;
      state.phase = 'speaking';

      const t6 = Date.now();
      console.log(`[TIMING] Agent API: Returning response at ${t6} (total: ${t6-t0}ms)`);

      return NextResponse.json({
        success: true,
        state,
        question,
        topicAreas,
        phase: 'speaking',
      });
    }

    // ── ACTION: answer ─────────────────────────
    if (action === 'answer') {
      const t1 = Date.now();
      console.log(`[TIMING] Agent API: Action=answer, parsed at ${t1} (+${t1-t0}ms)`);

      const { answer, state: prevState } = body as {
        answer: string;
        state: ExaminerState;
      };

      if (!answer?.trim()) {
        return NextResponse.json({ error: 'Answer is required' }, { status: 400 });
      }

      // Step 3: evaluate the answer
      const t2 = Date.now();
      console.log(`[TIMING] Agent API: Calling evaluateAnswer at ${t2} (+${t2-t1}ms)`);

      const evaluation = await evaluateAnswer(prevState, answer.trim());

      const t3 = Date.now();
      console.log(`[TIMING] Agent API: evaluateAnswer done at ${t3} (+${t3-t2}ms). Quality: ${evaluation.quality}`);

      // ── Early exit: answer too incomplete to score ──
      // Don't record the exchange, don't update scores — just re-ask.
      if (evaluation.quality === 'incomplete') {
        return NextResponse.json({
          success: true,
          state: prevState,                   // state unchanged
          question: evaluation.reprompt,      // the gentle re-ask is the "next question"
          quality: 'incomplete',
          feedback: '',
          topicAreas: prevState.topicAreas,
          phase: 'speaking',
        });
      }

      // Save exchange to history
      const currentArea = prevState.topicAreas[prevState.currentAreaIndex];
      const newExchange: ExchangeRecord = {
        areaId: currentArea.id,
        question: prevState.currentQuestion,
        answer: answer.trim(),
        quality: evaluation.quality,
        feedback: evaluation.feedback,
        timestamp: Date.now(),
      };

      // Update area score
      const updatedAreas = prevState.topicAreas.map((area, idx) =>
        idx === prevState.currentAreaIndex
          ? { ...area, score: evaluation.score }
          : area
      );

      const updatedState: ExaminerState = {
        ...prevState,
        currentAnswer: answer.trim(),
        currentQuality: evaluation.quality,
        currentFeedback: evaluation.feedback,
        exchanges: [...prevState.exchanges, newExchange],
        topicAreas: updatedAreas,
      };

      // Step 4: decide what to do next
      const t4 = Date.now();
      console.log(`[TIMING] Agent API: Calling decideNextStep at ${t4} (+${t4-t3}ms)`);

      const decision = decideNextStep(updatedState, evaluation.quality, newExchange);

      const t5 = Date.now();
      console.log(`[TIMING] Agent API: decideNextStep done at ${t5} (+${t5-t4}ms). Action: ${decision.action}`);

      // Step 5: act on decision
      if (decision.action === 'conclude') {
        const t6 = Date.now();
        console.log(`[TIMING] Agent API: Calling concludeSession at ${t6} (+${t6-t5}ms)`);

        const finalEvaluation = await concludeSession(updatedState);

        const t7 = Date.now();
        console.log(`[TIMING] Agent API: concludeSession done at ${t7} (+${t7-t6}ms)`);

        const finalState: ExaminerState = {
          ...updatedState,
          finalEvaluation,
          overallScore: finalEvaluation.overallScore,
          phase: 'complete',
          topicAreas: updatedAreas.map(a => ({ ...a, covered: true })),
        };

        return NextResponse.json({
          success: true,
          state: finalState,
          quality: evaluation.quality,
          feedback: evaluation.feedback,
          topicAreas: finalState.topicAreas,
          phase: 'complete',
          finalEvaluation,
          overallScore: finalEvaluation.overallScore,
        });
      }

      // Move to next area or follow up
      let nextState: ExaminerState = { ...updatedState };

      if (decision.action === 'next_area') {
        nextState = {
          ...updatedState,
          currentAreaIndex: updatedState.currentAreaIndex + 1,
          followUpCount: 0,
          topicAreas: updatedAreas.map((area, idx) =>
            idx === updatedState.currentAreaIndex
              ? { ...area, covered: true }
              : area
          ),
        };
      } else if (decision.action === 'follow_up') {
        nextState = {
          ...updatedState,
          followUpCount: updatedState.followUpCount + 1,
        };
      } else {
        // drill_deeper — stay on same area, reset followUpCount
        nextState = {
          ...updatedState,
          followUpCount: 0,
        };
      }

      // Generate next question
      const t6 = Date.now();
      console.log(`[TIMING] Agent API: Calling generateQuestion at ${t6} (+${t6-t5}ms)`);

      const nextQuestion = await generateQuestion(nextState);

      const t7 = Date.now();
      console.log(`[TIMING] Agent API: generateQuestion done at ${t7} (+${t7-t6}ms). Question: "${nextQuestion.substring(0, 50)}..."`);

      nextState.currentQuestion = nextQuestion;
      nextState.phase = 'speaking';

      const t8 = Date.now();
      console.log(`[TIMING] Agent API: Returning response at ${t8} (total: ${t8-t0}ms)`);

      return NextResponse.json({
        success: true,
        state: nextState,
        question: nextQuestion,
        quality: evaluation.quality,
        feedback: evaluation.feedback,
        topicAreas: nextState.topicAreas,
        phase: 'speaking',
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "start" or "answer".' },
      { status: 400 }
    );

  } catch (err) {
    console.error('[Sage Agent Error]', err);
    return NextResponse.json(
      { error: 'Agent failed. Check your OpenAI API key and try again.' },
      { status: 500 }
    );
  }
}
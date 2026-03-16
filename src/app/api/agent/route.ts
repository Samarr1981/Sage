import { NextRequest, NextResponse } from 'next/server';
import {
  initializeSession,
  generateQuestion,
  evaluateAnswer,
  decideNextStep,
  concludeSession,
} from '@/lib/agent/graph';
import type { ExaminerState, ExchangeRecord } from '@/lib/agent/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    // ── ACTION: start ──────────────────────────
    if (action === 'start') {
      const { topic, role, experienceLevel, interviewType } = body;
      if (!topic?.trim()) {
        return NextResponse.json({ error: 'Topic is required' }, { status: 400 });
      }

      // Step 1: break topic into areas
      const topicAreas = await initializeSession(topic.trim());

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
      const question = await generateQuestion(state);
      state.currentQuestion = question;
      state.phase = 'speaking';

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
      const { answer, state: prevState } = body as {
        answer: string;
        state: ExaminerState;
      };

      if (!answer?.trim()) {
        return NextResponse.json({ error: 'Answer is required' }, { status: 400 });
      }

      // Step 3: evaluate the answer
      const evaluation = await evaluateAnswer(prevState, answer.trim());

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
      const decision = decideNextStep(updatedState, evaluation.quality, newExchange);

      // Step 5: act on decision
      if (decision.action === 'conclude') {
        const finalEvaluation = await concludeSession(updatedState);
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
      const nextQuestion = await generateQuestion(nextState);
      nextState.currentQuestion = nextQuestion;
      nextState.phase = 'speaking';

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
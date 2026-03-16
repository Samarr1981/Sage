import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type {
  ExaminerState,
  AnswerQuality,
  TopicArea,
  ExchangeRecord,
  FinalEvaluation,
} from './types';

function getLLM() {
  return new ChatOpenAI({
    model: 'gpt-4o',
    temperature: 0.7,
    apiKey: process.env.OPENAI_API_KEY,
  });
}

function getLLMStrict() {
  return new ChatOpenAI({
    model: 'gpt-4o',
    temperature: 0.1,
    apiKey: process.env.OPENAI_API_KEY,
  });
}

// ─────────────────────────────────────────────
// STEP 1: Initialize — break topic into 3 areas
// ─────────────────────────────────────────────
export async function initializeSession(topic: string): Promise<TopicArea[]> {
  const llm = getLLM();

  const response = await llm.invoke([
    new SystemMessage(`You are an expert curriculum designer.
Given a topic, identify exactly 3 distinct knowledge areas to assess.
Respond ONLY with a JSON array. No markdown, no explanation.
Format: [{"id":"1","name":"Area Name"},{"id":"2","name":"Area Name"},{"id":"3","name":"Area Name"}]`),
    new HumanMessage(`Topic: ${topic}`),
  ]);

  const raw = response.content as string;
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  return parsed.map((a: { id: string; name: string }) => ({
    id: a.id,
    name: a.name,
    covered: false,
    score: null,
    questionCount: 0,
  }));
}

// ─────────────────────────────────────────────
// STEP 2: Generate a question for current area
// ─────────────────────────────────────────────
export async function generateQuestion(state: ExaminerState): Promise<string> {
  const llm = getLLM();
  const currentArea = state.topicAreas[state.currentAreaIndex];
  const areaExchanges = state.exchanges.filter(e => e.areaId === currentArea.id);

  const context = areaExchanges.length > 0
    ? `Previous exchanges in this area:\n${areaExchanges.map(e =>
        `Q: ${e.question}\nA: ${e.answer}\nQuality: ${e.quality}`
      ).join('\n\n')}`
    : 'This is the opening question for this area.';

  const lastExchange = state.exchanges[state.exchanges.length - 1];
  let instruction = '';

  if (state.followUpCount > 0 && lastExchange?.quality === 'medium') {
    instruction = `The student gave a medium-quality answer. Ask ONE clarifying follow-up that probes deeper into: "${lastExchange.answer}"`;
  } else if (lastExchange?.quality === 'weak') {
    instruction = `The student showed a gap. Ask a more foundational question to assess the basics of this area.`;
  } else {
    instruction = `Ask an opening assessment question for this area. Make it thought-provoking but clear.`;
  }

  const response = await llm.invoke([
    new SystemMessage(`You are Sage, a senior interviewer at a top tech company conducting a ${state.topic} interview.
You are assessing: "${currentArea.name}".
Candidate experience level: ${(state as any).experienceLevel || 'mid-level'}.
Interview type: ${(state as any).interviewType || 'mixed'}.
${context}

You ask questions exactly like a real interviewer would in person.
Short. Direct. No filler. No encouragement.

Rules:
- ONE question only, max 2 sentences
- Never start with "Can you", "Could you", "Would you mind"
- Never use "elaborate", "explain in detail", "walk me through"
- For technical roles: ask specific, concrete questions — not "what is X" but "how would you handle X in production"
- For behavioral: use real situations — "tell me about a time" style
- For weak answers: go more specific and concrete, not broader
- Sound like a human who is genuinely evaluating this candidate`),
    new HumanMessage(instruction),
  ]);

  return (response.content as string).trim();
}

// ─────────────────────────────────────────────
// STEP 3: Evaluate the student's answer
// ─────────────────────────────────────────────
export async function evaluateAnswer(
  state: ExaminerState,
  answer: string
): Promise<{ quality: AnswerQuality; score: number; feedback: string }> {
  const llm = getLLMStrict();
  const currentArea = state.topicAreas[state.currentAreaIndex];

  const response = await llm.invoke([
    new SystemMessage(`You are a senior interviewer evaluating a candidate for: "${state.topic}".
Area: "${currentArea.name}".
Experience level expected: ${(state as any).experienceLevel || 'mid-level'}.

Be honest. Be direct. Evaluate like you are deciding whether to pass this candidate.

Respond ONLY with JSON. No markdown, no explanation.
Format: {"quality":"strong"|"medium"|"weak","score":0-10,"feedback":"1-2 sentences, direct and specific"}

- strong: correct, confident, shows real experience (7-10)
- medium: partially right, missing specifics or depth (4-6)
- weak: vague, wrong, or clearly unprepared (0-3)

Feedback must be specific — reference what they actually said.`),
    new HumanMessage(`Question: ${state.currentQuestion}\nAnswer: ${answer}`),
  ]);

  const raw = response.content as string;
  const cleaned = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

// ─────────────────────────────────────────────
// STEP 4: Decide what happens next (the agentic logic)
// ─────────────────────────────────────────────
export function decideNextStep(
  state: ExaminerState,
  quality: AnswerQuality,
  newExchange: ExchangeRecord
): { action: 'next_area' | 'follow_up' | 'drill_deeper' | 'conclude' } {
  const isLastArea = state.currentAreaIndex >= state.topicAreas.length - 1;
  const currentArea = state.topicAreas[state.currentAreaIndex];

  // Count exchanges for this area INCLUDING the one just added
  const areaExchanges = [
    ...state.exchanges.filter(e => e.areaId === currentArea.id),
    newExchange,
  ];

  if (quality === 'strong') {
    return { action: isLastArea ? 'conclude' : 'next_area' };
  }

  if (quality === 'medium') {
    if (state.followUpCount >= 1) {
      return { action: isLastArea ? 'conclude' : 'next_area' };
    }
    return { action: 'follow_up' };
  }

  // weak — drill deeper up to 2 attempts, then move on
  if (areaExchanges.length >= 2) {
    return { action: isLastArea ? 'conclude' : 'next_area' };
  }
  return { action: 'drill_deeper' };
}

// ─────────────────────────────────────────────
// STEP 5: Generate final evaluation
// ─────────────────────────────────────────────
export async function concludeSession(state: ExaminerState): Promise<FinalEvaluation> {
  const llm = getLLM();

  const exchangeSummary = state.exchanges
    .map(e => {
      const area = state.topicAreas.find(a => a.id === e.areaId);
      return `Area: ${area?.name}\nQ: ${e.question}\nA: ${e.answer}\nQuality: ${e.quality}`;
    })
    .join('\n\n');

  const response = await llm.invoke([
    new SystemMessage(`You are a senior interviewer completing a ${state.interviewType} interview assessment.
Role being interviewed for: "${state.role}".
Candidate experience level: ${state.experienceLevel}.

Generate a brutally honest, specific final evaluation.
Respond ONLY with JSON. No markdown, no explanation.

Format:
{
  "summary": "2-3 sentences, honest overall assessment",
  "areaScores": [{"areaName":"...","score":0-10,"feedback":"1 specific sentence"}],
  "strengths": ["specific thing they did well — reference actual answer content"],
  "weakMoments": [
    {
      "question": "exact question asked",
      "answer": "what they actually said (summarized)",
      "whyWeak": "specific reason this answer was insufficient",
      "howToImprove": "concrete actionable advice for this exact weakness"
    }
  ],
  "areasForImprovement": ["specific gap 1", "specific gap 2"],
  "overallScore": 0-10,
  "readinessRating": "X% ready for this role",
  "recommendation": "1 concrete sentence on the single most important thing to work on"
}`),
    new HumanMessage(`Assessment exchanges:\n\n${exchangeSummary}`),
  ]);

  const raw = response.content as string;
  const cleaned = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}
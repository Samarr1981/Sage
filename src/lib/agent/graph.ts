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
    model: 'gpt-4o-mini',
    temperature: 0.7,
    apiKey: process.env.OPENAI_API_KEY,
  });
}

function getLLMStrict() {
  return new ChatOpenAI({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    apiKey: process.env.OPENAI_API_KEY,
  });
}

// ─────────────────────────────────────────────
// STEP 1: Initialize — break topic into 3 areas
// ─────────────────────────────────────────────
export async function initializeSession(topic: string): Promise<TopicArea[]> {
  const t0 = Date.now();
  console.log(`[TIMING] initializeSession: Starting at ${t0}`);

  const llm = getLLM();

  const t1 = Date.now();
  console.log(`[TIMING] initializeSession: Calling LLM at ${t1} (+${t1-t0}ms)`);

  const response = await llm.invoke([
    new SystemMessage(`You are an expert curriculum designer.
Given a topic, identify exactly 3 distinct knowledge areas to assess.
Respond ONLY with a JSON array. No markdown, no explanation.
Format: [{"id":"1","name":"Area Name"},{"id":"2","name":"Area Name"},{"id":"3","name":"Area Name"}]`),
    new HumanMessage(`Topic: ${topic}`),
  ]);

  const t2 = Date.now();
  console.log(`[TIMING] initializeSession: LLM response received at ${t2} (+${t2-t1}ms)`);

  const raw = response.content as string;
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  const result = parsed.map((a: { id: string; name: string }) => ({
    id: a.id,
    name: a.name,
    covered: false,
    score: null,
    questionCount: 0,
  }));

  const t3 = Date.now();
  console.log(`[TIMING] initializeSession: Done at ${t3} (total: ${t3-t0}ms)`);

  return result;
}

// ─────────────────────────────────────────────
// STEP 2: Generate a question for current area
// ─────────────────────────────────────────────
export async function generateQuestion(state: ExaminerState): Promise<string> {
  const t0 = Date.now();
  console.log(`[TIMING] generateQuestion: Starting at ${t0}`);

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

  const t1 = Date.now();
  console.log(`[TIMING] generateQuestion: Calling LLM at ${t1} (+${t1-t0}ms)`);

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

  const t2 = Date.now();
  console.log(`[TIMING] generateQuestion: LLM response received at ${t2} (+${t2-t1}ms)`);

  const result = (response.content as string).trim();

  const t3 = Date.now();
  console.log(`[TIMING] generateQuestion: Done at ${t3} (total: ${t3-t0}ms)`);

  return result;
}

// ─────────────────────────────────────────────
// STEP 3: Evaluate the student's answer
// ─────────────────────────────────────────────

// Reprompts used when an answer is too thin to score.
const REPROMPTS = [
  "It seems like your answer got cut off — could you try again?",
  "Could you elaborate on that a bit more?",
  "That was a bit brief — give me a fuller answer.",
  "I didn't catch enough there. Can you walk me through your thinking?",
  "Take your time and give me a complete answer.",
];

function pickReprompt(): string {
  return REPROMPTS[Math.floor(Math.random() * REPROMPTS.length)];
}

function isAnswerTooShort(answer: string): boolean {
  const words = answer.trim().split(/\s+/).filter(Boolean);
  return words.length < 15;
}

export async function evaluateAnswer(
  state: ExaminerState,
  answer: string
): Promise<{ quality: AnswerQuality; score: number; feedback: string; reprompt?: string }> {
  const t0 = Date.now();
  console.log(`[TIMING] evaluateAnswer: Starting at ${t0}`);

  // ── Fast pre-check: skip LLM entirely for obvious fragments ──
  if (isAnswerTooShort(answer)) {
    const t1 = Date.now();
    console.log(`[TIMING] evaluateAnswer: Answer too short, skipping LLM at ${t1} (+${t1-t0}ms)`);
    return { quality: 'incomplete', score: 0, feedback: '', reprompt: pickReprompt() };
  }

  const llm = getLLMStrict();
  const currentArea = state.topicAreas[state.currentAreaIndex];

  const t1 = Date.now();
  console.log(`[TIMING] evaluateAnswer: Calling LLM at ${t1} (+${t1-t0}ms)`);

  const response = await llm.invoke([
    new SystemMessage(`You are a senior interviewer evaluating a candidate for: "${state.topic}".
Area: "${currentArea.name}".
Experience level expected: ${(state as any).experienceLevel || 'mid-level'}.

Be honest. Be direct. Evaluate like you are deciding whether to pass this candidate.

IMPORTANT — before scoring, check whether the answer is actually evaluable:
- If the answer is a sentence fragment, cuts off mid-thought, contains no verb or substance, or is clearly noise/filler (e.g. "um", "I think maybe", "yeah basically"), do NOT score it.
- If the answer does not contain enough information to assess the candidate's knowledge, do NOT score it.
- In those cases, return the incomplete format below.

Respond ONLY with JSON. No markdown, no explanation.

If the answer IS evaluable:
{"quality":"strong"|"medium"|"weak","score":0-10,"feedback":"1-2 sentences, direct and specific"}

If the answer is NOT evaluable (fragment, cut off, no substance):
{"quality":"incomplete","score":0,"feedback":"","reprompt":"<one natural sentence asking them to try again>"}

Scoring rubric (only applies to evaluable answers):
- strong: correct, confident, shows real experience (score 7-10)
- medium: partially right, missing specifics or depth (score 4-6)
- weak: vague, wrong, or clearly unprepared (score 0-3)

Feedback must be specific — reference what they actually said.`),
    new HumanMessage(`Question: ${state.currentQuestion}\nAnswer: ${answer}`),
  ]);

  const t2 = Date.now();
  console.log(`[TIMING] evaluateAnswer: LLM response received at ${t2} (+${t2-t1}ms)`);

  const raw = response.content as string;
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  // If the LLM flagged it as incomplete but didn't supply a reprompt, add one
  if (parsed.quality === 'incomplete' && !parsed.reprompt) {
    parsed.reprompt = pickReprompt();
  }

  const t3 = Date.now();
  console.log(`[TIMING] evaluateAnswer: Done at ${t3} (total: ${t3-t0}ms)`);

  return parsed;
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
  const t0 = Date.now();
  console.log(`[TIMING] concludeSession: Starting at ${t0}`);

  const llm = getLLM();

  const exchangeSummary = state.exchanges
    .map(e => {
      const area = state.topicAreas.find(a => a.id === e.areaId);
      return `Area: ${area?.name}\nQ: ${e.question}\nA: ${e.answer}\nQuality: ${e.quality}`;
    })
    .join('\n\n');

  const t1 = Date.now();
  console.log(`[TIMING] concludeSession: Calling LLM at ${t1} (+${t1-t0}ms)`);

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

  const t2 = Date.now();
  console.log(`[TIMING] concludeSession: LLM response received at ${t2} (+${t2-t1}ms)`);

  const raw = response.content as string;
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const result = JSON.parse(cleaned);

  const t3 = Date.now();
  console.log(`[TIMING] concludeSession: Done at ${t3} (total: ${t3-t0}ms)`);

  return result;
}
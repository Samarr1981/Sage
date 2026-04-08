import { NextRequest, NextResponse } from 'next/server';
import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

function getLLMStrict() {
  return new ChatOpenAI({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    apiKey: process.env.OPENAI_API_KEY,
  });
}

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

export async function POST(req: NextRequest) {
  try {
    const t0 = Date.now();
    console.log(`[TIMING] Realtime Evaluate API: Request received at ${t0}`);

    const { question, answer, topic, areaName, experienceLevel } = await req.json();

    if (!question?.trim() || !answer?.trim()) {
      return NextResponse.json({ error: 'Question and answer are required' }, { status: 400 });
    }

    const t1 = Date.now();
    console.log(`[TIMING] Realtime Evaluate: Evaluating answer at ${t1} (+${t1-t0}ms)`);

    // Fast pre-check: skip LLM entirely for obvious fragments
    if (isAnswerTooShort(answer)) {
      const t2 = Date.now();
      console.log(`[TIMING] Realtime Evaluate: Answer too short, skipping LLM at ${t2} (+${t2-t1}ms)`);
      return NextResponse.json({
        quality: 'incomplete',
        score: 0,
        feedback: '',
        reprompt: pickReprompt(),
      });
    }

    const llm = getLLMStrict();

    const response = await llm.invoke([
      new SystemMessage(`You are a senior interviewer evaluating a candidate for: "${topic}".
Area: "${areaName}".
Experience level expected: ${experienceLevel || 'mid-level'}.

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
      new HumanMessage(`Question: ${question}\nAnswer: ${answer}`),
    ]);

    const t2 = Date.now();
    console.log(`[TIMING] Realtime Evaluate: LLM response received at ${t2} (+${(t2-t1)}ms)`);

    const raw = response.content as string;
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    // If the LLM flagged it as incomplete but didn't supply a reprompt, add one
    if (parsed.quality === 'incomplete' && !parsed.reprompt) {
      parsed.reprompt = pickReprompt();
    }

    const t3 = Date.now();
    console.log(`[TIMING] Realtime Evaluate: Done at ${t3} (total: ${t3-t0}ms)`);

    return NextResponse.json(parsed);

  } catch (err) {
    console.error('[Realtime Evaluate Error]', err);
    return NextResponse.json({ error: 'Evaluation failed' }, { status: 500 });
  }
}

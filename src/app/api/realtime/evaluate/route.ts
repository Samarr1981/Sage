import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const REPROMPTS = [
  "It seems like your answer got cut off. Could you try again?",
  "Could you elaborate on that a bit more?",
  "That was a bit brief. Give me a fuller answer.",
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
    console.log(`[TIMING] Realtime Evaluate: Evaluating answer at ${t1} (+${t1 - t0}ms)`);

    if (isAnswerTooShort(answer)) {
      const t2 = Date.now();
      console.log(`[TIMING] Realtime Evaluate: Answer too short, skipping LLM at ${t2} (+${t2 - t1}ms)`);
      return NextResponse.json({
        quality: 'incomplete',
        score: 0,
        feedback: '',
        reprompt: pickReprompt(),
      });
    }

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: `You are a senior interviewer evaluating a candidate for: "${topic}".
Area: "${areaName}".
Experience level expected: ${experienceLevel || 'mid-level'}.

Be honest. Be direct. Evaluate like you are deciding whether to pass this candidate.

IMPORTANT — before scoring, check whether the answer is actually evaluable:
- If the answer is a sentence fragment, cuts off mid-thought, or is clearly noise/filler, do NOT score it.
- If the answer does not contain enough information to assess knowledge, do NOT score it.

Respond ONLY with JSON. No markdown, no explanation.

If evaluable:
{"quality":"strong"|"medium"|"weak","score":0-10,"feedback":"1-2 sentences, direct and specific"}

If not evaluable:
{"quality":"incomplete","score":0,"feedback":"","reprompt":"<one natural sentence asking them to try again>"}

Scoring:
- strong: correct, confident, shows real experience (score 7-10)
- medium: partially right, missing specifics or depth (score 4-6)
- weak: vague, wrong, or clearly unprepared (score 0-3)

Feedback must reference what they actually said.`,
      messages: [
        {
          role: 'user',
          content: `Question: ${question}\nAnswer: ${answer}`,
        },
      ],
    });

    const t2 = Date.now();
    console.log(`[TIMING] Realtime Evaluate: LLM response received at ${t2} (+${t2 - t1}ms)`);

    const raw = response.content[0].type === 'text' ? response.content[0].text : '';
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (parsed.quality === 'incomplete' && !parsed.reprompt) {
      parsed.reprompt = pickReprompt();
    }

    const t3 = Date.now();
    console.log(`[TIMING] Realtime Evaluate: Done at ${t3} (total: ${t3 - t0}ms)`);

    return NextResponse.json(parsed);

  } catch (err) {
    console.error('[Realtime Evaluate Error]', err);
    return NextResponse.json({ error: 'Evaluation failed' }, { status: 500 });
  }
}
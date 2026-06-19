import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { extractJson } from '@/lib/extractJson';

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
      temperature: 0.2,
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

Scoring (anchor on 5 = a borderline pass, the minimum you'd accept):
- strong (7-10): correct, confident, shows real hands-on experience
- medium (4-6): partially right, but missing specifics, depth, or precision
- weak (0-3): vague, wrong, or clearly unprepared
A 5 is "barely acceptable," not "pretty good." Most real answers should land where they actually deserve, not drift toward the middle.

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
    const parsed = extractJson(raw);

    // Model returned junk: do NOT crash the interview, return a neutral result and move on.
    if (!parsed) {
      console.error('[Realtime Evaluate] Failed to parse model output:', raw);
      return NextResponse.json({ quality: 'medium', score: 5, feedback: '' });
    }

    // Sanitize before trusting the model's fields.
    if (typeof parsed.score === 'number') {
      parsed.score = Math.max(0, Math.min(10, Math.round(parsed.score)));
    } else {
      parsed.score = 5;
    }
    if (!['strong', 'medium', 'weak', 'incomplete'].includes(parsed.quality)) {
      parsed.quality = 'medium';
    }
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
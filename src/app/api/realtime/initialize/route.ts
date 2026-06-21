import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { extractJson } from '@/lib/extractJson';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

type RoundType = 'screening' | 'technical' | 'final';

const ROUND_INSTRUCTIONS: Record<RoundType, string> = {
  screening: `
Round type: SCREENING
Frame this as a friendly recruiter call. The goal is broad qualification and fit — not deep technical drilling.
- Areas should cover: motivation for this role/company, basic qualification check, and culture/team fit signals.
- Skills to test should be lightweight and conversational — things a recruiter can actually evaluate.
- Gaps should flag missing must-have requirements, not every small mismatch.
- "strongAnswerLooksLike" should describe enthusiasm, clarity, and basic competence — not depth.`,

  technical: `
Round type: TECHNICAL
This is a rigorous deep-dive. The goal is to stress-test the candidate's actual technical depth.
- Areas must be the core technical skills and systems from the JD — not soft skills, not motivation.
- "skillsToTest" should be specific: algorithms, system design patterns, specific technologies, debugging judgment.
- "gapsToProbe" is the most important section: surface every mismatch between JD requirements and resume signals.
- "strengthsToConfirm" should focus on specific technical claims: architectures, scale numbers, stack choices.
- "strongAnswerLooksLike" should set a high bar — production experience, nuance, trade-off awareness.`,

  final: `
Round type: FINAL
This is a values, judgment, and senior-fit round. The goal is to assess how they work, not just what they know.
- Areas should focus on: ownership and initiative, navigating ambiguity or conflict, and "why us" at a deeper level.
- "skillsToTest" should be behavioral themes: e.g. "drove a project end-to-end without hand-holding", "navigated a technical disagreement".
- "gapsToProbe" should surface judgment or leadership gaps suggested by career trajectory.
- "strengthsToConfirm" should probe whether claimed leadership was real ("says they led X — confirm they made the key calls").
- "strongAnswerLooksLike" should describe clear ownership, self-awareness, and specific impact — not vague stories.`,
};

function buildSystemPrompt(roundType: RoundType): string {
  return `You are an expert technical interviewer preparing a structured interview plan.
You will receive a candidate's resume (as a PDF) and a job description.
Read both carefully and produce a tailored interview plan as a single JSON object.

Rules:
- Extract "role" from the JD title or scope.
- Extract "company" from the JD if present, otherwise null.
- Extract "seniority" from the JD's experience requirements, title, and responsibility scope. Default to "mid-level" if genuinely unclear.
- Produce EXACTLY 3 areas. No more, no fewer.
- Each area must be directly relevant to this specific role, seniority, and round type.
- "gapsToProbe" highlights mismatches or missing signals between the resume and JD requirements.
- "strengthsToConfirm" lists specific resume claims worth verifying in the interview.
- Respond ONLY with the JSON object. No markdown, no explanation, no preamble.

Required JSON shape:
{
  "role": "string",
  "company": "string | null",
  "seniority": "junior | mid-level | senior",
  "roundType": "string",
  "areas": [
    {
      "name": "string",
      "whyRelevant": "string",
      "skillsToTest": ["string"],
      "strongAnswerLooksLike": "string"
    }
  ],
  "gapsToProbe": [{ "gap": "string", "howToProbe": "string" }],
  "strengthsToConfirm": ["string"]
}
${ROUND_INSTRUCTIONS[roundType]}`;
}

export async function POST(req: NextRequest) {
  try {
    const t0 = Date.now();
    console.log(`[TIMING] Realtime Initialize API: Request received at ${t0}`);

    const { resumePdfBase64, jobDescription, roundType } = await req.json();

    if (!resumePdfBase64?.trim()) {
      return NextResponse.json({ error: 'resumePdfBase64 is required' }, { status: 400 });
    }
    if (!jobDescription?.trim()) {
      return NextResponse.json({ error: 'jobDescription is required' }, { status: 400 });
    }
    if (!['screening', 'technical', 'final'].includes(roundType)) {
      return NextResponse.json(
        { error: 'roundType must be one of: screening, technical, final' },
        { status: 400 }
      );
    }

    const t1 = Date.now();
    console.log(`[TIMING] Realtime Initialize: Calling Claude at ${t1} (+${t1 - t0}ms)`);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      temperature: 0.4,
      system: buildSystemPrompt(roundType as RoundType),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: resumePdfBase64,
              },
            } as Anthropic.DocumentBlockParam,
            {
              type: 'text',
              text: `Job Description:\n\n${jobDescription}\n\nRound type: ${roundType}\n\nProduce the interview plan JSON now.`,
            },
          ],
        },
      ],
    });

    const t2 = Date.now();
    console.log(`[TIMING] Realtime Initialize: LLM response received at ${t2} (+${t2 - t1}ms)`);

    const textBlock = response.content.find((b) => b.type === 'text');
const raw = textBlock && textBlock.type === 'text' ? textBlock.text : '';
    const parsed = extractJson(raw);

    if (!parsed || !Array.isArray(parsed.areas) || parsed.areas.length !== 3) {
      console.error('[Realtime Initialize] Failed to parse model output:', raw);
      return NextResponse.json(
        { error: 'Initialization failed: could not parse interview plan from model output' },
        { status: 500 }
      );
    }

    // Backward-compatible topicAreas shape for the current caller in useRealtimeSession
    const topicAreas = parsed.areas.map((a: { name: string }, i: number) => ({
      id: String(i + 1),
      name: a.name,
      covered: false,
      score: null,
      questionCount: 0,
    }));

    const t3 = Date.now();
    console.log(`[TIMING] Realtime Initialize: Done at ${t3} (total: ${t3 - t0}ms)`);

    return NextResponse.json({
      success: true,
      ...parsed,
      roundType, // always echo back the input value, even if Claude paraphrased it
      topicAreas,
    });

  } catch (err) {
    console.error('[Realtime Initialize Error]', err);
    return NextResponse.json({ error: 'Initialization failed' }, { status: 500 });
  }
}

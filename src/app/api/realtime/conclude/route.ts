import { NextRequest, NextResponse } from 'next/server';
import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

function getLLM() {
  return new ChatOpenAI({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    apiKey: process.env.OPENAI_API_KEY,
  });
}

export async function POST(req: NextRequest) {
  try {
    const t0 = Date.now();
    console.log(`[TIMING] Realtime Conclude API: Request received at ${t0}`);

    const { exchanges, role, experienceLevel, interviewType, topicAreas } = await req.json();

    if (!exchanges || exchanges.length === 0) {
      return NextResponse.json({ error: 'No exchanges to evaluate' }, { status: 400 });
    }

    const llm = getLLM();

    const exchangeSummary = exchanges
      .map((e: any) => {
        const area = topicAreas.find((a: any) => a.id === e.areaId);
        return `Area: ${area?.name || 'Unknown'}\nQ: ${e.question}\nA: ${e.answer}\nQuality: ${e.quality}`;
      })
      .join('\n\n');

    const t1 = Date.now();
    console.log(`[TIMING] Realtime Conclude: Calling LLM at ${t1} (+${t1-t0}ms)`);

    const response = await llm.invoke([
      new SystemMessage(`You are a senior interviewer completing a ${interviewType} interview assessment.
Role being interviewed for: "${role}".
Candidate experience level: ${experienceLevel}.

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
    console.log(`[TIMING] Realtime Conclude: LLM response received at ${t2} (+${(t2-t1)}ms)`);

    const raw = response.content as string;
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const finalEvaluation = JSON.parse(cleaned);

    const t3 = Date.now();
    console.log(`[TIMING] Realtime Conclude: Done at ${t3} (total: ${t3-t0}ms)`);

    return NextResponse.json({
      success: true,
      finalEvaluation,
    });

  } catch (err) {
    console.error('[Realtime Conclude Error]', err);
    return NextResponse.json({ error: 'Conclusion failed' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const t0 = Date.now();
    console.log(`[TIMING] Realtime Conclude API: Request received at ${t0}`);

    const { exchanges, role, experienceLevel, interviewType, topicAreas } = await req.json();

    if (!exchanges || exchanges.length === 0) {
      return NextResponse.json({ error: 'No exchanges to evaluate' }, { status: 400 });
    }

    const exchangeSummary = exchanges
      .map((e: any) => {
        const area = topicAreas.find((a: any) => a.id === e.areaId);
        return `Area: ${area?.name || 'Unknown'}\nQ: ${e.question}\nA: ${e.answer}\nQuality: ${e.quality}`;
      })
      .join('\n\n');

    const t1 = Date.now();
    console.log(`[TIMING] Realtime Conclude: Calling LLM at ${t1} (+${t1-t0}ms)`);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      temperature: 0.3,
      system: `You are a senior technical interviewer delivering a final assessment for a ${interviewType} interview.
Role: "${role}". Candidate level: ${experienceLevel}.

Your job is to give an honest evaluation that actually helps this person improve. Inflated scores are useless. Vague feedback is useless.

Respond ONLY with valid JSON. No markdown fences, no explanation, no preamble.

SCORING RUBRIC — overallScore (0-10):
9-10: Exceptional. Near every answer had specifics, metrics, or demonstrated clear mastery. Rare. Do not give this unless the evidence is unambiguous.
7-8: Strong. Most answers were solid with real depth. Minor gaps only.
5-6: Mixed. Some good answers but notable weaknesses. Not ready without improvement.
3-4: Struggling. Vague answers dominated. Significant preparation needed.
1-2: Unprepared. Could not demonstrate baseline competency for this role.
0: No evaluable content.

Default assumption: start at 5. Move up only when the exchange content earns it. Do not award 7+ without specific evidence in the exchanges.

RULES:
- Any answer with a quality of "weak" or score below 5 MUST appear in weakMoments. Do not skip them.
- readinessRating must equal overallScore * 10, followed by "% ready for this role". Example: overallScore 6 = "60% ready for this role". Do not deviate.
- Feedback must reference what the candidate actually said. Generic feedback is not acceptable.
- Strengths must cite specific answers, not general traits.
- weakMoments.whyWeak must name the specific gap — not "lacked depth", but what exactly was missing.
- weakMoments.howToImprove must be actionable for this exact question and answer, not generic advice.

JSON format:
{
  "summary": "2-3 sentences. Honest overall assessment referencing what actually happened in the interview.",
  "areaScores": [{"areaName": "...", "score": 0-10, "feedback": "1 specific sentence referencing their actual answer"}],
  "strengths": ["specific thing — reference the actual answer content, not a trait"],
  "weakMoments": [
    {
      "question": "exact question asked",
      "answer": "what they actually said, summarized honestly",
      "whyWeak": "specific gap — what exactly was missing or wrong",
      "howToImprove": "concrete actionable advice for this exact weakness"
    }
  ],
  "areasForImprovement": ["specific gap 1", "specific gap 2"],
  "overallScore": 0-10,
  "readinessRating": "X% ready for this role",
  "recommendation": "1 sentence. The single most important thing to work on before the next interview."
}`,
      messages: [{ role: 'user', content: `Assessment exchanges:\n\n${exchangeSummary}` }],
    });

    const t2 = Date.now();
    console.log(`[TIMING] Realtime Conclude: LLM response received at ${t2} (+${(t2-t1)}ms)`);

    const raw = response.content[0].type === 'text' ? response.content[0].text : '';
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

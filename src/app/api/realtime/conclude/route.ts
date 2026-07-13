import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import Anthropic from '@anthropic-ai/sdk';
import { extractJson } from '@/lib/extractJson';
import { createAdminClient } from '@/lib/supabase';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const t0 = Date.now();
    console.log(`[TIMING] Realtime Conclude API: Request received at ${t0}`);

    const { exchanges, role, experienceLevel, interviewType, topicAreas, plan } = await req.json();

    if (!exchanges || exchanges.length === 0) {
      return NextResponse.json({ error: 'No exchanges to evaluate' }, { status: 400 });
    }

    // Derive the save target from the server-verified session rather than
    // trusting a client-supplied clerkUserId — otherwise a spoofed body field
    // could attribute a saved session to a different account. Anonymous
    // candidates (userId === null) simply skip the save, same as before.
    const { userId: authedClerkId } = await auth();

    const exchangeSummary = exchanges
      .map((e: any) => {
        const area = topicAreas.find((a: any) => a.id === e.areaId);
        return `Area: ${area?.name || 'Unknown'}\nQ: ${e.question}\nA: ${e.answer}\nQuality: ${e.quality}`;
      })
      .join('\n\n');

    const planBlock = plan?.areas?.length
      ? plan.areas.map((a: any, i: number) =>
          `Area ${i + 1}: ${a.name}\n  Why it matters: ${a.whyRelevant}\n  Skills to test: ${(a.skillsToTest || []).join(', ')}\n  A strong answer looks like: ${a.strongAnswerLooksLike}`
        ).join('\n\n')
      : 'No interview plan provided — grade against the literal question and answer text.';

    const t1 = Date.now();
    console.log(`[TIMING] Realtime Conclude: Calling LLM at ${t1} (+${t1-t0}ms)`);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      temperature: 0.3,
      system: `You are a senior technical interviewer delivering a final assessment for a ${interviewType} interview.
Role: "${role}". Candidate level: ${experienceLevel}.

Your job is to give an honest evaluation that actually helps this person improve. Inflated scores are useless. Vague feedback is useless.

Respond ONLY with valid JSON. No markdown fences, no explanation, no preamble.

AUDIO-ONLY CONTEXT:
You are evaluating a transcript of a VOICE interview. You did not see or hear the candidate. You have text only.
- NEVER assert visual observations. No "appeared nervous", "seemed hesitant", "looked uncertain", "body language".
- NEVER assert audio observations. No "sounded unsure", "spoke quietly", "hesitated", "long pauses", "trailed off".
- NEVER comment on audio quality, transcription quality, connection issues, or the interview being disrupted. You cannot distinguish a system fault from a candidate behavior, so do not speculate about either.
- Evaluate ONLY the substance of what was said. If you cannot assess something from the words alone, do not assess it.

STITCH FRAGMENTED TURNS:
The transcript may split a single candidate answer across multiple consecutive turns. This is a transport artifact of the voice pipeline, not a speech pattern.
- Before evaluating, mentally concatenate all consecutive candidate turns into one answer, and evaluate that combined answer.
- NEVER treat fragmentation as a communication weakness.
- NEVER describe an answer as "disjointed", "fragmented", "scattered", or "hard to follow" on the basis of turn structure.

GRADE AGAINST THE CANONICAL QUESTION:
You will receive the interview plan (areas, skills to test, what a strong answer looks like). Grade the candidate against the SUBSTANCE of what was asked, not the literal transcript text of the question.
- If the transcript of a question is garbled or truncated, reconstruct the intent from the interview plan and grade against that.
- If the candidate asked for a question to be repeated, that is a system artifact. NEVER penalize it, never mention it, never treat it as poor listening or lack of focus.
- If the interviewer interrupted the candidate, NEVER hold the resulting short or incomplete answer against them.

ASR ERROR HANDLING:
The transcript comes from automatic speech recognition and contains errors, especially with technical terms and proper nouns.
- Silently correct obvious ASR errors when reading. "APIE" is "API". "Superbase" is "Supabase". "Vappy" is "Vapi". "post grease" is "Postgres". "no JS" is "Node.js". Infer the intended term from technical context.
- NEVER quote a mangled term back to the candidate in the report. If you quote them, quote the corrected form.
- NEVER penalize the candidate for a term the transcriber mangled. If a word looks wrong but the surrounding reasoning is sound, assume the candidate said it correctly.
- If a passage is genuinely unintelligible, ignore it. Do not guess and do not score it.

WHAT COUNTS AS A GAP:
Only these are legitimate weaknesses:
- The candidate did not know something they should know for this role and level.
- The candidate's reasoning was wrong, shallow, or unsupported.
- The candidate explicitly said they don't know.
- The candidate made a claim they could not back up when pushed.
These are NEVER weaknesses and must never appear in the report:
- Fragmented or split transcript turns
- Requests to repeat a question
- Mangled proper nouns or technical terms
- Short answers that followed an interviewer interruption
- Anything about audio, connection, or transcription quality
If a criticism would not survive the candidate reading the transcript and saying "the system did that, not me", do not write it.

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
      messages: [{ role: 'user', content: `Interview plan (grade against the substance of these areas, not the literal transcript text of the question):\n\n${planBlock}\n\nAssessment exchanges:\n\n${exchangeSummary}` }],
    });

    const t2 = Date.now();
    console.log(`[TIMING] Realtime Conclude: LLM response received at ${t2} (+${(t2-t1)}ms)`);

    const raw = response.content[0].type === 'text' ? response.content[0].text : '';
const finalEvaluation = extractJson(raw);

if (!finalEvaluation) {
  console.error('[Realtime Conclude] Failed to parse model output:', raw);
  return NextResponse.json({ error: 'Could not generate evaluation' }, { status: 500 });
}

    // Persist to Supabase. Never fail the overall response on a DB error — the
    // candidate still gets their evaluation — but every failure is captured in
    // `saveError` and reported back to the caller so it can surface to the
    // user instead of vanishing into a server log.
    let sessionSaved = false;
    let saveError: string | null = null;

    if (authedClerkId) {
      try {
        const supabase = createAdminClient();

        const { data: userRow, error: userErr } = await supabase
          .from('users')
          .select('id')
          .eq('clerk_id', authedClerkId)
          .single();

        if (userErr || !userRow) {
          saveError = userErr ? `Could not look up user: ${userErr.message}` : 'No matching user record — sign-in sync may have failed';
        } else {
          const { data: sessionRow, error: sessionErr } = await supabase
            .from('sessions')
            .insert({ user_id: userRow.id, role, level: experienceLevel, transcript: exchanges, plan: plan ?? null })
            .select('id')
            .single();

          if (sessionErr || !sessionRow) {
            saveError = `Could not save session: ${sessionErr?.message ?? 'unknown error'}`;
          } else {
            const { error: evalErr } = await supabase.from('evaluations').insert({
              session_id: sessionRow.id,
              overall_score: finalEvaluation.overallScore,
              strengths: finalEvaluation.strengths ?? [],
              improvements: finalEvaluation.areasForImprovement ?? [],
            });

            if (evalErr) {
              saveError = `Could not save evaluation: ${evalErr.message}`;
            } else {
              sessionSaved = true;
            }
          }
        }
      } catch (dbErr: any) {
        saveError = dbErr?.message ?? 'Unexpected error while saving session';
      }

      if (saveError) {
        console.error('[Realtime Conclude] Supabase save failed:', saveError);
      }
    }

    const t3 = Date.now();
    console.log(`[TIMING] Realtime Conclude: Done at ${t3} (total: ${t3-t0}ms)`);

    return NextResponse.json({
      success: true,
      finalEvaluation,
      // Only meaningful when the candidate was signed in — anonymous sessions
      // are never saved and sessionSaved stays false with no saveError.
      sessionSaved,
      saveError,
    });

  } catch (err) {
    console.error('[Realtime Conclude Error]', err);
    return NextResponse.json({ error: 'Conclusion failed' }, { status: 500 });
  }
}

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
    console.log(`[TIMING] Realtime Initialize API: Request received at ${t0}`);

    const { topic } = await req.json();

    if (!topic?.trim()) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 });
    }

    const llm = getLLM();

    const t1 = Date.now();
    console.log(`[TIMING] Realtime Initialize: Calling LLM at ${t1} (+${t1-t0}ms)`);

    const response = await llm.invoke([
      new SystemMessage(`You are an expert curriculum designer.
Given a topic, identify exactly 3 distinct knowledge areas to assess.
Respond ONLY with a JSON array. No markdown, no explanation.
Format: [{"id":"1","name":"Area Name"},{"id":"2","name":"Area Name"},{"id":"3","name":"Area Name"}]`),
      new HumanMessage(`Topic: ${topic}`),
    ]);

    const t2 = Date.now();
    console.log(`[TIMING] Realtime Initialize: LLM response received at ${t2} (+${t2-t1}ms)`);

    const raw = response.content as string;
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const topicAreas = parsed.map((a: { id: string; name: string }) => ({
      id: a.id,
      name: a.name,
      covered: false,
      score: null,
      questionCount: 0,
    }));

    const t3 = Date.now();
    console.log(`[TIMING] Realtime Initialize: Done at ${t3} (total: ${t3-t0}ms)`);

    return NextResponse.json({
      success: true,
      topicAreas,
    });

  } catch (err) {
    console.error('[Realtime Initialize Error]', err);
    return NextResponse.json({ error: 'Initialization failed' }, { status: 500 });
  }
}

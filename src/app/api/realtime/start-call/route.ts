import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { buildVapiSystemPrompt, type InterviewPlan } from '@/lib/agent/buildVapiSystemPrompt';
import { checkRateLimit } from '@/lib/rateLimit';

// The Vapi dashboard assistant whose non-model config (voice, transcriber,
// analysis plan, etc.) every temporary per-interview assistant should inherit.
const DASHBOARD_ASSISTANT_ID = '85a73bb3-d87d-4a5a-bd62-55ee094e40eb';

// Hard cost backstop — no round (screening: 4-5 Qs, technical: 6-8 Qs,
// final: 4-6 Qs, plus follow-ups) should ever need this long.
const MAX_DURATION_SECONDS = 1800;

type RoundType = 'screening' | 'technical' | 'final';

function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  return forwardedFor?.split(',')[0]?.trim() || 'unknown';
}

export async function POST(req: NextRequest) {
  try {
    const privateKey = process.env.VAPI_PRIVATE_KEY;
    if (!privateKey) {
      return NextResponse.json({ error: 'VAPI_PRIVATE_KEY is not configured' }, { status: 500 });
    }

    // realtime/* routes are intentionally unauthenticated (anonymous users can
    // take a free interview) — auth() here is only to key the rate limiter by
    // account when one exists, falling back to IP for anonymous callers.
    const { userId } = await auth();
    const rateLimitKey = userId ?? `ip:${getClientIp(req)}`;
    if (!checkRateLimit(rateLimitKey)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await req.json();
    const { plan, roundType } = body as { plan?: InterviewPlan; roundType?: RoundType };

    if (!plan || typeof plan !== 'object' || !Array.isArray(plan.areas) || plan.areas.length === 0) {
      return NextResponse.json({ error: 'plan is required' }, { status: 400 });
    }
    if (roundType !== 'screening' && roundType !== 'technical' && roundType !== 'final') {
      return NextResponse.json({ error: 'roundType must be one of screening, technical, final' }, { status: 400 });
    }

    const t0 = Date.now();
    console.log(`[TIMING] Realtime Start-Call API: Request received at ${t0}`);

    const systemPrompt = buildVapiSystemPrompt(plan, roundType);

    // Copy the dashboard assistant's non-model config (voice, transcriber,
    // analysis plan, etc.) so behavior doesn't silently change just because
    // the model + first message now come from this route instead.
    const dashboardRes = await fetch(`https://api.vapi.ai/assistant/${DASHBOARD_ASSISTANT_ID}`, {
      headers: { Authorization: `Bearer ${privateKey}` },
    });

    if (!dashboardRes.ok) {
      const text = await dashboardRes.text();
      console.error('[Vapi] Failed to fetch dashboard assistant:', dashboardRes.status, text);
      return NextResponse.json({ error: 'Failed to load base assistant config' }, { status: 502 });
    }

    const dashboardAssistant = await dashboardRes.json();
    const t1 = Date.now();
    console.log(`[TIMING] Realtime Start-Call: Fetched dashboard assistant at ${t1} (+${t1 - t0}ms)`);

    // Strip identity/timestamp fields (not valid on create) and the fields
    // we're deliberately overriding below; keep everything else (voice,
    // transcriber, analysisPlan, etc.) as-is from the dashboard config.
    const {
      id: _id,
      orgId: _orgId,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      model: _model,
      firstMessageMode: _firstMessageMode,
      maxDurationSeconds: _maxDurationSeconds,
      isServerUrlSecretSet: _isServerUrlSecretSet,
      ...baseConfig
    } = dashboardAssistant;

    const createRes = await fetch('https://api.vapi.ai/assistant', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${privateKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...baseConfig,
        model: {
          provider: 'openai',
          model: 'gpt-4.1',
          messages: [{ role: 'system', content: systemPrompt }],
          temperature: 0.6,
        },
        firstMessageMode: 'assistant-speaks-first-with-model-generated-message',
        maxDurationSeconds: MAX_DURATION_SECONDS,
      }),
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      console.error('[Vapi] Failed to create temp assistant:', createRes.status, text);
      return NextResponse.json({ error: 'Failed to create interview assistant' }, { status: 502 });
    }

    const created = await createRes.json();
    const t2 = Date.now();
    console.log(`[TIMING] Realtime Start-Call: Created temp assistant ${created.id} at ${t2} (+${t2 - t1}ms)`);

    return NextResponse.json({ assistantId: created.id });
  } catch (err: any) {
    console.error('[Realtime Start-Call Error]', err);
    return NextResponse.json({ error: err.message || 'Failed to start call' }, { status: 500 });
  }
}

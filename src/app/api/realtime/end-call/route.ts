import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const privateKey = process.env.VAPI_PRIVATE_KEY;
    if (!privateKey) {
      return NextResponse.json({ error: 'VAPI_PRIVATE_KEY is not configured' }, { status: 500 });
    }

    const { assistantId } = await req.json();
    if (!assistantId || typeof assistantId !== 'string') {
      return NextResponse.json({ error: 'assistantId is required' }, { status: 400 });
    }

    const t0 = Date.now();
    console.log(`[TIMING] Realtime End-Call API: Deleting assistant ${assistantId} at ${t0}`);

    const res = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${privateKey}` },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[Vapi] Failed to delete temp assistant:', res.status, text);
      return NextResponse.json({ error: 'Failed to delete assistant' }, { status: 502 });
    }

    const t1 = Date.now();
    console.log(`[TIMING] Realtime End-Call: Deleted assistant ${assistantId} at ${t1} (+${t1 - t0}ms)`);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[Realtime End-Call Error]', err);
    return NextResponse.json({ error: err.message || 'Failed to end call' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const t0 = Date.now();
    console.log(`[TIMING] Realtime Session API: Request received at ${t0}`);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    // Create ephemeral session token for Realtime API
    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-realtime-1.5',
        voice: 'verse',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Realtime Session Error]', response.status, errorText);
      return NextResponse.json(
        { error: 'Failed to create session', details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();

    const t1 = Date.now();
    console.log(`[TIMING] Realtime Session API: Session created at ${t1} (+${t1-t0}ms)`);
    console.log('[Realtime Session] Full response:', JSON.stringify(data, null, 2));

    // Extract the client_secret - it should contain the WebSocket URL
    // The structure should be: { client_secret: { value: "wss://..." } }
    let clientSecret: string | undefined;

    if (data.client_secret) {
      if (typeof data.client_secret === 'string') {
        clientSecret = data.client_secret;
      } else if (data.client_secret.value) {
        clientSecret = data.client_secret.value;
      }
    }

    console.log('[Realtime Session] Extracted client_secret:', clientSecret);

    if (!clientSecret) {
      console.error('[Realtime Session] No valid client_secret in response');
      console.error('[Realtime Session] Response structure:', Object.keys(data));
      return NextResponse.json({ error: 'Invalid session response - no client_secret' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      clientSecret,
    });

  } catch (err) {
    console.error('[Realtime Session Error]', err);
    return NextResponse.json({ error: 'Session creation failed' }, { status: 500 });
  }
}

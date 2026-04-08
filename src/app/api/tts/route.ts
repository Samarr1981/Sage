import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const t0 = Date.now();
    console.log(`[TIMING] TTS API: Request received at ${t0}`);

    const { text } = await req.json();

    if (!text?.trim()) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const t1 = Date.now();
    console.log(`[TIMING] TTS API: Calling OpenAI TTS (streaming) at ${t1} (+${t1-t0}ms) for text: "${text.substring(0, 50)}..."`);

    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: text,
      speed: 1.15,
      response_format: 'mp3',
    });

    const t2 = Date.now();
    console.log(`[TIMING] TTS API: OpenAI TTS stream started at ${t2} (+${t2-t1}ms), beginning streaming to client`);

    // Stream the response directly to the client
    const stream = response.body;

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-cache',
        'Transfer-Encoding': 'chunked',
      },
    });

  } catch (err) {
    console.error('[TTS Error]', err);
    return NextResponse.json({ error: 'TTS failed' }, { status: 500 });
  }
}
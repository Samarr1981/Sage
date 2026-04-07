import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audio = formData.get('audio') as Blob | null;

    if (!audio || audio.size === 0) {
      return NextResponse.json({ error: 'No audio provided' }, { status: 400 });
    }

    // Determine file extension from MIME type so Whisper accepts it
    const mime = audio.type || 'audio/webm';
    const ext = mime.includes('mp4') || mime.includes('m4a') ? 'm4a'
              : mime.includes('ogg') ? 'ogg'
              : mime.includes('wav') ? 'wav'
              : 'webm';

    const file = new File([audio], `audio.${ext}`, { type: mime });

    const result = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'en',
    });

    return NextResponse.json({ transcript: result.text });
  } catch (err: any) {
    console.error('[STT Error]', err);
    return NextResponse.json({ error: err.message || 'STT failed' }, { status: 500 });
  }
}

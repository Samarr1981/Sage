import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import jwt from 'jsonwebtoken';
import { checkRateLimit } from '@/lib/rateLimit';

// This account's Vapi org id (Vapi dashboard → Settings → Org). Not a
// secret — required in the JWT payload alongside the scope claim.
const VAPI_ORG_ID = '5564ff9c-9e41-4444-ae36-b570460404a4';

// Generous relative to the observed connect() → call-start round trip
// (token fetch + new Vapi() + vapi.start() WebRTC handshake, ~5s warm) —
// short enough that a leaked token is useless within minutes.
const TOKEN_TTL_SECONDS = 120;

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

    // realtime/* routes are intentionally unauthenticated (anonymous users
    // can take a free interview) — auth() here is only to key the rate
    // limiter by account when one exists, falling back to IP otherwise.
    const { userId } = await auth();
    const rateLimitKey = userId ?? `ip:${getClientIp(req)}`;
    if (!checkRateLimit(rateLimitKey)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const origin = req.headers.get('origin');

    // Public scope authorizes only https://api.vapi.ai/call/web (web call
    // creation) — the Web SDK can start a call and nothing else. See
    // https://docs.vapi.ai/customization/jwt-authentication.
    const payload = {
      orgId: VAPI_ORG_ID,
      token: {
        tag: 'public' as const,
        restrictions: {
          enabled: Boolean(origin),
          allowedOrigins: origin ? [origin] : [],
          allowTransientAssistant: false,
        },
      },
    };

    const token = jwt.sign(payload, privateKey, {
      algorithm: 'HS256',
      expiresIn: TOKEN_TTL_SECONDS,
    });

    return NextResponse.json({ token });
  } catch (err: any) {
    console.error('[Vapi Token Error]', err);
    return NextResponse.json({ error: err.message || 'Failed to mint token' }, { status: 500 });
  }
}

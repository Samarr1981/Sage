// Pulls a saved session's transcript + plan from Supabase, reconstructs the
// exact payload POST /api/realtime/conclude expects, and prints the resulting
// finalEvaluation. Useful for iterating on the grader system prompt against a
// real transcript without re-running a live interview each time.
//
// Usage: pnpm test-grader <session-id>
// Requires a local `next dev` server running on https://localhost:3000
// (this repo runs `next dev --experimental-https`, so the dev server only
// serves HTTPS with a self-signed cert — see the TLS note below).
//
// Queries Supabase's PostgREST endpoint directly rather than going through
// @supabase/supabase-js — that client eagerly spins up a realtime WebSocket
// client in its constructor, which throws under plain Node 20 (no native
// WebSocket) even though this script only needs a single REST read.

const CONCLUDE_URL = 'https://localhost:3000/api/realtime/conclude';

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error('Usage: pnpm test-grader <session-id>');
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local).');
    process.exit(1);
  }

  const restRes = await fetch(
    `${supabaseUrl}/rest/v1/sessions?id=eq.${encodeURIComponent(sessionId)}&select=role,level,transcript,plan`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    },
  );

  if (!restRes.ok) {
    console.error(`Supabase REST error ${restRes.status}:`, await restRes.text());
    process.exit(1);
  }

  const rows = await restRes.json();
  const session = rows[0];

  if (!session) {
    console.error(`Session "${sessionId}" not found.`);
    process.exit(1);
  }

  if (!session.transcript) {
    console.error(`Session "${sessionId}" has no stored transcript — nothing to grade.`);
    process.exit(1);
  }

  const plan: any = session.plan ?? null;

  // Mirrors the payload built in handleInterviewComplete (src/app/page.tsx) —
  // this is the exact shape POST /api/realtime/conclude expects.
  const payload = {
    exchanges: session.transcript,
    role: session.role,
    experienceLevel: session.level,
    interviewType: plan?.roundType ?? 'mixed',
    topicAreas: plan?.topicAreas ?? [],
    plan,
  };

  console.log(`Grading session "${sessionId}" (${payload.exchanges.length} exchanges)...`);

  // next dev --experimental-https serves a self-signed cert. Node's fetch
  // (undici) honors NODE_TLS_REJECT_UNAUTHORIZED, so disable verification
  // only around this local request, then restore it immediately after.
  // Local dev script only — never do this against a real endpoint.
  const prevTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  let res: Response;
  try {
    res = await fetch(CONCLUDE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } finally {
    if (prevTlsSetting === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTlsSetting;
  }

  const data = await res.json();

  if (!res.ok) {
    console.error(`conclude route returned ${res.status}:`, data.error ?? data);
    process.exit(1);
  }

  console.log(JSON.stringify(data.finalEvaluation, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

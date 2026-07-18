import { NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { syncClerkUser } from '@/lib/syncUser';
import { checkRateLimit } from '@/lib/rateLimit';

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!checkRateLimit(userId)) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again in a minute.' }, { status: 429 });
  }

  const user = await currentUser();
  const email = user?.emailAddresses[0]?.emailAddress ?? null;
  await syncClerkUser({ clerkId: userId, email });

  return NextResponse.json({ ok: true });
}

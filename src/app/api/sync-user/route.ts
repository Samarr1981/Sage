import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { syncClerkUser } from '@/lib/syncUser';

export async function POST() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const email = user.emailAddresses[0]?.emailAddress ?? null;
  await syncClerkUser({ clerkId: user.id, email });

  return NextResponse.json({ ok: true });
}

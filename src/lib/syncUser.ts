import { createAdminClient } from './supabase';

/**
 * Upserts a Clerk user into the Supabase users table.
 * Call this server-side (API route or Server Component) on first login.
 * Returns the Supabase user row id.
 */
export async function syncClerkUser({
  clerkId,
  email,
}: {
  clerkId: string;
  email: string | null;
}): Promise<string> {
  const db = createAdminClient();

  const { data: existing } = await db
    .from('users')
    .select('id')
    .eq('clerk_id', clerkId)
    .single();

  if (existing) return existing.id as string;

  const { data, error } = await db
    .from('users')
    .insert({ clerk_id: clerkId, email })
    .select('id')
    .single();

  if (error) throw new Error(`syncClerkUser: ${error.message}`);
  return data.id as string;
}

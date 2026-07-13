-- ─────────────────────────────────────────────────────────────────────────────
-- sessions: store the raw exchange transcript and the interview plan the
-- session was graded against, so a saved session can be re-read/re-graded
-- without needing the original in-memory client state.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.sessions
  add column if not exists transcript jsonb,
  add column if not exists plan       jsonb;

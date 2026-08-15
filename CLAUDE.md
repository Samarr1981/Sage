# CLAUDE.md — Sage

A map of this codebase for Claude Code (and for me). It records what each file actually does
right now, which paths are live and which are legacy, and the conventions to follow when adding
code.

Keep it accurate. If you change what a file does, update the row here in the same commit — a
stale map is worse than no map, because it gets trusted.

---

## 1. The shape of the system

One interview engine runs in production: **Vapi carries the live voice call, Claude does the
planning and the scoring.**

| Concern | Runs on | Where |
|---|---|---|
| Live spoken conversation | `gpt-4.1` inside Vapi's WebRTC bridge | `useRealtimeSession.ts` → `vapi.start()` |
| Transcription | Deepgram, primed per-interview with keyterms | configured in `/api/realtime/start-call` |
| Interview plan (3 topic areas) | `claude-sonnet-4-6`, Anthropic SDK | `/api/realtime/initialize` |
| Final scored report | `claude-sonnet-4-6`, Anthropic SDK | `/api/realtime/conclude` |
| Per-answer scoring | `claude-haiku-4-5-20251001`, Anthropic SDK | `/api/realtime/evaluate` — **built, no caller yet** |

Two things are not part of the live path and should not be mistaken for it:

- **`/api/realtime/evaluate`** is complete and tested but nothing calls it. It exists to enable
  mid-call adaptation (see §5).
- **`useSpeech.ts`** is a hook from the pre-Vapi architecture. Its transcript loop is dead code,
  but four of its return values are still load-bearing in `page.tsx` (§5).

There is no LangChain or LangGraph in this project. An earlier LangGraph engine and its
`/api/agent` route were deleted in `bc98ab9` (2026-06-20); the unused `@langchain/*` packages were
dropped afterwards. Don't reintroduce them without a reason.

---

## 2. File-by-file map

### Pages & layout
| File | Role |
|---|---|
| `src/app/layout.tsx` | Root layout. `ClerkProvider`, global CSS, Vercel Analytics. |
| `src/app/page.tsx` | **2,189 lines.** Landing page, ready screen, live session UI, evaluation report, auth gate. The main refactoring target — see §5 and the size rules in §6. |
| `src/app/globals.css` | Tailwind base plus CSS custom properties (`--bg`, `--accent`, `--green/yellow/red`) and keyframes (`orb-breathe`, `wave`, `ticker-scroll`). Components reference these via inline `style={{ color: 'var(--accent)' }}`. |
| `src/app/sign-in/[[...sign-in]]/`, `sign-up/…` | Clerk `<SignIn>`/`<SignUp>` in a Sage-branded split-screen layout. |

### API routes (`src/app/api/`)
| Route | Status | What it does | Model |
|---|---|---|---|
| `realtime/initialize` | LIVE | Reads the resume PDF and JD, returns exactly 3 `TopicArea[]`. Called at interview start. | `claude-sonnet-4-6` |
| `realtime/vapi-token` | LIVE | Mints a 120s HS256 JWT scoped to web call creation, locked to the request origin. | — |
| `realtime/start-call` | LIVE | Builds the system prompt server-side, copies the cached dashboard assistant's non-model config, overrides model + keyterms, creates a temporary Vapi assistant. | — |
| `realtime/end-call` | LIVE | Fire-and-forget delete of the temporary assistant. Swallows errors; never blocks the UI. |  — |
| `realtime/conclude` | LIVE | Takes `ExchangeRecord[]` + metadata, returns `FinalEvaluation`, persists session and evaluation to Supabase when the user is signed in. | `claude-sonnet-4-6` |
| `realtime/evaluate` | BUILT, NO CALLER | Scores one Q&A exchange (`quality`, `score`, `feedback`, optional `reprompt`). | `claude-haiku-4-5` |
| `stt`, `tts` | LEGACY | Whisper transcription and OpenAI TTS. Belong to the pre-Vapi path via `useSpeech`. | `whisper-1`, `tts-1` |
| `sync-user` | LIVE | Upserts the Clerk user into the Supabase `users` table. | — |

### `src/lib/`
| File | Role |
|---|---|
| `agent/buildVapiSystemPrompt.ts` | Single source of the interview system prompt. Called only from `/api/realtime/start-call`; the prompt never reaches the client. |
| `agent/types.ts` | Shared interview types — `TopicArea`, `ExchangeRecord`, `FinalEvaluation`. |
| `extractJson.ts` | Tolerant JSON extraction from model output. Every structured-output route uses it. Unit tested. |
| `hooks/useRealtimeSession.ts` | Vapi call lifecycle, event stream, transcripts, exchange recording. |
| `hooks/useSpeech.ts` | **Legacy.** Pre-Vapi Web Speech + Whisper + TTS loop. Transcript loop is dead; `unlockAudio`, `isSupported`, `error`, `cancel` are still used by `page.tsx`. Untangle those before deleting. |
| `rateLimit.ts` | In-memory limiter, 10 req/min per key. Per-instance on serverless — see §5. |
| `supabase.ts`, `syncUser.ts` | Supabase clients and user sync. |
| `exportReport.ts` | Renders the final evaluation to a downloadable report. |

### Other
| File | Role |
|---|---|
| `src/middleware.ts` | Clerk middleware. `/`, `/sign-in`, `/sign-up`, `/interview`, `/api/*` are public; API routes handle their own auth. |
| `supabase/migrations/` | `users`, `sessions`, `evaluations`, all with RLS policies scoping rows to their owner. |
| `jest.config.ts`, `__mocks__/server-only.js` | Jest setup. `server-only` is stubbed because route handlers pull it in transitively via Clerk/Supabase. |
| `scripts/test-grader.ts` | Manual harness for exercising the grader outside the app. |

---

## 3. The live data flow

```
1. Landing page → InterviewForm → handleFormSubmit
2. Desktop: handleStart()                  Mobile: ReadyScreen pre-fetch → handleReadyBegin()
   │
   ├─ POST /api/realtime/initialize   (claude-sonnet-4-6 → 3 TopicAreas, i.e. `plan`)
   │
   ├─ POST /api/realtime/vapi-token   (120s scoped JWT)
   │
   ├─ POST /api/realtime/start-call   ({ plan, roundType } →
   │                                   buildVapiSystemPrompt() server-side →
   │                                   cached dashboard assistant config →
   │                                   POST /assistant on Vapi → { assistantId })
   │
   └─ realtimeSession.connect(assistantId, { topic, level, interviewType })
        └─ vapi.start(assistantId, { variableValues })

3. Live call — useRealtimeSession listens to Vapi's event stream:
   - assistant transcript (final) → currentQuestion, onQuestionReceived
   - user transcript (final)      → push ExchangeRecord{ quality: 'medium' (placeholder) }
                                     → increment area questionCount
                                     → advance currentAreaIndex after 2 Qs/area
   - volume-level                 → drives LiveOrb animation
   - "That wraps up our interview..." → vapi.stop() → call-end

4. call-end → onInterviewComplete → handleInterviewComplete()
   │         → fire-and-forget POST /api/realtime/end-call (deletes the temp assistant)
   └─ POST /api/realtime/conclude   (claude-sonnet-4-6 → FinalEvaluation → Supabase)
        └─ setAppPhase('complete') → <EvaluationScreen>
```

Mobile chains `initialize` and `start-call` inside one pre-fetch promise before the
gesture-triggered `vapi.start()`, because `getUserMedia` must be called from a user gesture.

---

## 4. State in `page.tsx`

`Home()` owns page-navigation state (`appPhase`, role/level/type, modal visibility). Everything
about the call lifecycle lives in `useRealtimeSession`. Values that must be read inside a Vapi
event handler or a `useCallback([])` are mirrored into a `useRef` synced by a `useEffect` — the
`topicAreasRef` / `exchangesRef` pattern.

---

## 5. Known debt

Don't be surprised by these, and don't "fix" them silently.

1. **`page.tsx` is 2,189 lines**, mixing marketing content, three overlay screens, and the
   interview state machine. It's under a one-way ratchet (§6): it may only shrink.
   `InterviewForm`, `PreInterviewInstructionsModal`, and `SaveStatusToast` are already extracted.
2. **`useSpeech` is a zombie hook.** Its main loop is dead; four return values are still
   load-bearing. Don't delete it as part of an unrelated change.
3. **`ExchangeRecord.quality` is always `'medium'`** at recording time (`useRealtimeSession.ts`,
   ~line 186). Real scoring happens post-call in `/api/realtime/conclude`, which re-derives
   quality from the raw exchange. Wiring up `/api/realtime/evaluate` mid-call is the natural fix.
4. **The rate limiter is in-memory**, so on serverless it is per-instance rather than a true
   distributed limit. Correct for current traffic, wrong shape for real scale.
5. **Heavy inline `console.log('[TIMING] ...')` instrumentation** in `page.tsx` and the API
   routes. Noisy but intentional — it's how latency gets debugged here. Leave it unless asked.

---

## 6. Rules for adding code

### Component size & structure
- **No new component over ~150 lines.** If a JSX block grows past that, extract it to its own
  function component — its own file under `src/components/` if it's reusable across screens.
- **`page.tsx` should only shrink, never grow.** New UI for the interview/evaluation flow goes in
  new files under `src/components/interview/`, imported into `page.tsx`. Do not add new inline
  subcomponents to `page.tsx`.
- Presentational components (orbs, rings, badges, tickers) stay pure — props in, JSX out, no
  `fetch`, no Vapi/Clerk/Supabase imports.
- **Before adding logic to `page.tsx`**, check whether it belongs to a self-contained
  subcomponent — one that's `memo`'d, owns its local state, and communicates only via props
  (`InterviewForm`, `PreInterviewInstructionsModal`, `SaveStatusToast` are the pattern) — that
  could be extracted first.

### Where state lives
- **Vapi call lifecycle and session data** (transcripts, exchanges, topic areas, connection
  status) belongs in `useRealtimeSession` — extend that hook, don't duplicate its state.
- **Cross-callback values**: mirror into a `useRef` synced via `useEffect`, following
  `topicAreasRef` / `exchangesRef`. Do not widen `connect`'s dependency array.
- **Form and navigation state** stays in `Home()`.
- No new global state library — the ref-mirroring pattern is the convention and the app is small
  enough that it's sufficient.

### API routes
- **One model client per route** — a module-level `client` at the top of the file. Don't share
  client instances across routes.
- **Auth**: `stt`, `tts`, and `sync-user` start with `const { userId } = await auth()` plus
  `checkRateLimit`. The `realtime/*` routes are intentionally unauthenticated so anonymous users
  can take a free interview — `conclude` treats `userId === null` as "skip the save". Keep that
  distinction explicit; don't silently add auth to `realtime/*` or remove it from the others.
- **Always validate the request body shape** before using it, especially for anything that
  reaches an LLM.
- **Parsing JSON from a model**: use `extractJson` from `src/lib/extractJson.ts`. Don't hand-roll
  fence stripping — that helper is the tested path.
- New routes that make external API calls should log `[TIMING]` markers like existing ones do.
- A logging statement must never be able to fail a request. `/api/realtime/initialize` logs
  `response.usage.input_tokens`; if you copy that pattern, guard it.

### Naming & types
- Shared interview-domain types go in `agent/types.ts`.
- Match existing naming: `handleX` for event handlers, `XRef` for a ref mirror of state `X`,
  `useX` for hooks, route folders named for the resource (`api/realtime/<verb>`).

### Testing
- Jest covers the routes that parse model output plus `extractJson`. Model output is the least
  trustworthy input in the system, so that's where tests belong.
- Route tests must mock `@anthropic-ai/sdk`, `@/lib/supabase`, and `@clerk/nextjs/server`. Mock
  Anthropic responses need `usage` and `stop_reason`, not just `content` — the routes read them.

### General
- **Before wiring up `/api/realtime/evaluate`**, check whether the injection mechanism
  (`vapi.send()` or otherwise) needs the message marked hidden/system-only so it isn't spoken
  aloud or shown in the transcript. Nothing else in the codebase does this, so it needs its own
  testing pass against a live call.

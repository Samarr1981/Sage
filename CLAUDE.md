# CLAUDE.md — Sage

This file is the map Claude Code (and you) should use to navigate this codebase. It documents
what every file actually does **right now** — including which code paths are live, which are
dead, and which are half-built — plus the rules to follow when adding new code.

For product-level explanation (interview flow, why Vapi, why no DB originally, etc.) see
`SAGE_DOCS.md`. That file is mostly accurate but predates the Supabase/Clerk auth work and the
Claude Haiku evaluation route — treat anything it says about "no database" or "no auth gate" as
historical.

---

## 1. The one thing to internalize first

**There are three interview-engine implementations in this repo, and only one of them runs in
production.** This is the single biggest source of confusion. Before touching any "interview
logic," confirm which of the three you're actually looking at:

| # | Implementation | Status | Model | Entry point |
|---|---|---|---|---|
| 1 | **Vapi + gpt-4o live conversation** | ✅ LIVE — this is the product | gpt-4o via Vapi's WebRTC bridge | `useRealtimeSession.ts` → `vapi.start()` |
| 2 | **LangGraph agent** (`graph.ts` + `/api/agent`) | ❌ DEAD — not called from any UI | gpt-4o-mini via LangChain | `/api/agent` (orphaned route) |
| 3 | **Claude Haiku per-answer evaluator** (`/api/realtime/evaluate`) | 🚧 IN PROGRESS — built but not yet wired up | claude-haiku-4-5 via Anthropic SDK | `/api/realtime/evaluate` (orphaned route, no caller yet) |

The mid-call injection feature you're building now is the thing that will finally make #3 live —
it's currently a fully-working endpoint with zero callers.

---

## 2. File-by-file map

### Pages & layout
| File | Role |
|---|---|
| `src/app/layout.tsx` | Root layout. Wraps app in `ClerkProvider`, loads global CSS, mounts Vercel Analytics. |
| `src/app/page.tsx` | **2,314 lines.** Everything renders here: landing page, interview form, ready screen, live session UI, evaluation report, auth gate. See §4 — this file is the main refactoring target. |
| `src/app/globals.css` | Tailwind base + CSS custom properties (`--bg`, `--accent`, `--green/yellow/red`, etc.) and keyframe animations (`orb-breathe`, `wave`, `ticker-scroll`...). All component styling references these vars via inline `style={{ color: 'var(--accent)' }}`. |
| `src/app/sign-in/[[...sign-in]]/page.tsx`, `sign-up/...` | Clerk `<SignIn>`/`<SignUp>` wrapped in Sage-branded layout (split-screen on desktop). |

### API routes (`src/app/api/`)
| Route | Status | What it does | Model |
|---|---|---|---|
| `realtime/initialize` | ✅ LIVE | Splits a topic into exactly 3 `TopicArea[]`. Called at interview start. | gpt-4o-mini (LangChain) |
| `realtime/start-call` | ✅ LIVE | Takes `{ plan, roundType }`, builds the full interview system prompt server-side via `lib/agent/buildVapiSystemPrompt.ts`, fetches the dashboard assistant (`85a73bb3-...`) to copy its non-model config, and mints a temporary per-interview Vapi assistant (POST `/assistant`) with that prompt + a `maxDurationSeconds` cost backstop. Returns `{ assistantId }` — the prompt itself never reaches the client. Called right after `realtime/initialize`, before `vapi.start()`. Rate-limited per user/IP. | — (calls Vapi's REST API with `VAPI_PRIVATE_KEY`) |
| `realtime/end-call` | ✅ LIVE | Takes `{ assistantId }`, deletes that temporary Vapi assistant (DELETE `/assistant/{id}`). Called two ways: fire-and-forget from `useRealtimeSession`'s `call-end` handler, and again from `page.tsx`'s `handleRestart` as a belt-and-suspenders cleanup — both swallow errors and don't block the UI. | — |
| `realtime/conclude` | ✅ LIVE | Takes all `ExchangeRecord[]` + metadata, returns `FinalEvaluation`. Called when Vapi detects the closing phrase. | gpt-4o-mini (LangChain) |
| `realtime/evaluate` | 🚧 ORPHANED (no caller yet) | Scores a single Q&A exchange (`quality`, `score`, `feedback`, optional `reprompt`). Just migrated from gpt-4o-mini → **claude-haiku-4-5** via the raw Anthropic SDK (see git history — this is the file open in your IDE). This is the endpoint your mid-call injection feature will call. | claude-haiku-4-5 (Anthropic SDK) |
| `realtime/session` | ❌ DEAD | Creates an ephemeral OpenAI Realtime API session token. Built for a direct-WebSocket implementation that was replaced by Vapi. Vapi manages its own tokens — nothing calls this. | — |
| `agent` | ❌ DEAD | Full request/response interview loop (`action: 'start' \| 'answer'`) backed by `lib/agent/graph.ts`. Requires Clerk auth + rate limiting. Not called by the current UI (the live flow uses Vapi directly, not this route). | gpt-4o-mini (LangChain) |
| `stt` | Used only by legacy `useSpeech` path | Whisper transcription fallback for browsers without Web Speech API / iOS. | whisper-1 |
| `tts` | Used only by legacy `useSpeech` path + a "warmup ping" in `handleShowForm` | Streams MP3 audio for spoken text. | tts-1, voice `nova`, speed 1.15 |
| `sync-user` | ✅ LIVE | Upserts the signed-in Clerk user into Supabase `users` table. Called once per session from `page.tsx` when `isSignedIn` flips true. | — |

### `src/lib/`
| File | Status | Role |
|---|---|---|
| `hooks/useRealtimeSession.ts` | ✅ LIVE — the core of the product | Owns the entire Vapi WebRTC lifecycle: creates the `Vapi` instance, registers all event listeners (`call-start`, `transcript`, `speech-start/end`, `volume-level`, `error`), tracks `exchanges`/`topicAreas`/`currentAreaIndex`, exposes `connect(assistantId, variables)`/`disconnect()`/`initializeInterview()`. `connect()` takes a temporary assistant id minted by `/api/realtime/start-call` — it no longer builds or receives a system prompt itself. On `call-end` it fire-and-forgets a call to `/api/realtime/end-call` to delete that temporary assistant. **Note:** it records each user answer as an `ExchangeRecord` with a hardcoded `quality: 'medium'` placeholder — real per-answer evaluation does not happen yet. That's the gap your mid-call injection work fills. |
| `agent/buildVapiSystemPrompt.ts` | ✅ LIVE — server-only | Exports `InterviewPlan` and `buildVapiSystemPrompt(plan, roundType)`. Moved here from `page.tsx` so the full interview prompt (follow-up protocol, round directives, closing phrase, etc.) is only ever built and read server-side, inside `/api/realtime/start-call` — never sent to the client. Do not import this from `page.tsx` or any other client component. |
| `hooks/useSpeech.ts` | ⚠️ PARTIALLY DEAD | Legacy hook from the pre-Vapi WebSocket/MediaRecorder architecture (Web Speech API + Whisper + OpenAI TTS, with the `isSageSpeakingRef` echo-prevention pattern). Its core transcript loop (`handleTranscript` → `/api/agent` → TTS playback) is **dead code** — never reached in the live Vapi flow. However `page.tsx` still instantiates it and uses `unlockAudio`, `isSupported`, `error`, and `cancel` from it (passed into `InterviewForm` and called in `handleRestart`). Don't delete this hook without first untangling those four still-live call sites. |
| `agent/graph.ts` | ❌ DEAD | The original LangGraph-style interview engine: `initializeSession`, `generateQuestion`, `evaluateAnswer`, `decideNextStep` (pure router), `concludeSession`. Only reachable via the orphaned `/api/agent` route. Kept as a reference for "what controllable interview logic looks like" — see SAGE_DOCS §8 for the stated rationale. |
| `agent/types.ts` | ✅ LIVE | Shared types: `TopicArea`, `ExchangeRecord`, `FinalEvaluation`, `ExaminerState`, `AnswerQuality`, `InterviewType`, `ExperienceLevel`, `AgentPhase`. Used by both the live and dead flows — this is why it's hard to tell from imports alone which flow you're in. |
| `supabase.ts` | ✅ LIVE | Two Supabase client factories: `createClient()` (browser, RLS-bound, anon key) and `createAdminClient()` (server-only, service-role key, bypasses RLS — never import client-side). |
| `syncUser.ts` | ✅ LIVE | `syncClerkUser()` — upserts a Clerk user into the Supabase `users` table. The *only* Supabase write path that exists right now. |
| `rateLimit.ts` | Used by `agent`, `stt`, `tts`, `realtime/start-call` routes | In-memory `Map`-based limiter, 10 req/min/key, keyed by `${key}:${minuteWindow}`. Most `realtime/*` routes aren't auth-gated and don't call this; `realtime/start-call` is the exception — it mints a billable Vapi assistant per call, so it rate-limits by Clerk `userId` when signed in, falling back to a `ip:<x-forwarded-for>` key for anonymous callers. Resets on server restart; doesn't share state across Vercel instances — fine for now, would need Upstash Redis at scale. |

### Other
| File | Role |
|---|---|
| `src/middleware.ts` | Clerk middleware. Marks `/`, `/sign-in`, `/sign-up`, `/interview*`, and **all** `/api/*` routes as public — each API route does its own `auth()` check at the handler level. |
| `src/types/global.d.ts` | CSS module type declaration (added for the Vercel build — see recent commit). |
| `supabase/migrations/001_initial_schema.sql` | Defines `users`, `sessions`, `evaluations` tables with RLS policies keyed on `auth.jwt() ->> 'sub'` (the Clerk user ID via the Clerk→Supabase JWT template). **Important: `sessions` and `evaluations` are defined and RLS-protected but nothing in the app writes to them yet.** Only `users` is populated, via `syncClerkUser`. If you're asked to "save interview history," this schema is already half-ready — you'd be adding the write path, not designing the schema. |

---

## 3. The live data flow (what actually runs in production)

```
1. Landing page → InterviewForm → handleFormSubmit
2. Desktop: handleStart()                  Mobile: ReadyScreen pre-fetch → handleReadyBegin()
   │                                          │
   ├─ POST /api/realtime/initialize  ────────┤   (gpt-4o-mini → 3 TopicAreas, i.e. `plan`)
   │
   ├─ POST /api/realtime/start-call  ────────┤   ({ plan, roundType } →
   │  (mobile: chained inside the same          buildVapiSystemPrompt() server-side →
   │   pre-fetch promise, before the             fetch dashboard assistant for voice/
   │   gesture-triggered vapi.start())           transcriber config → POST /assistant
   │                                             on Vapi → { assistantId })
   │  The full system prompt is built and read only inside this route — it never
   │  reaches the client. See `lib/agent/buildVapiSystemPrompt.ts`.
   │
   └─ realtimeSession.connect(assistantId, {topic, level, interviewType})
        │
        └─ vapi.start(assistantId, { variableValues })
             │
3. Live call — useRealtimeSession listens to Vapi's event stream:
   - assistant transcript (final) → currentQuestion, onQuestionReceived
   - user transcript (final)      → push ExchangeRecord{ quality: 'medium' (placeholder!) }
                                     → increment area questionCount
                                     → advance currentAreaIndex after 2 Qs/area
   - volume-level                 → drives LiveOrb animation
   - assistant transcript contains "That wraps up our interview..." → vapi.stop() → call-end

4. call-end → onInterviewComplete → handleInterviewComplete()
   │         → fire-and-forget POST /api/realtime/end-call ({ assistantId }) — deletes
   │           the temporary assistant, swallows errors, never blocks the UI
   └─ POST /api/realtime/conclude  (gpt-4o-mini → FinalEvaluation)
        └─ setAppPhase('complete') → <EvaluationScreen>
```

**Where your mid-call injection slots in:** step 3, on each final user transcript — after the
`ExchangeRecord` is pushed (currently with a `quality: 'medium'` placeholder), call
`/api/realtime/evaluate` with `{ question, answer, topic, areaName, experienceLevel }`, then use
`vapi.send()` to inject a hidden system message so Vapi's gpt-4o knows whether to probe deeper or
move on. That also gives you a chance to replace the `quality: 'medium'` placeholder with the
real score before it's used in the final report.

---

## 4. State & component structure of `page.tsx`

Everything (`landing | loading | session | complete`) renders from one component tree, gated by
`appPhase` state in `Home()`. This is intentional — see SAGE_DOCS "Single Route Architecture":
navigating between Next.js routes would tear down the Vapi WebRTC connection.

Rough map of what's in the file, top to bottom:
- **Pure presentational subcomponents** (`LiveOrb`, `StatusLabel`, `ProgressTracker`,
  `FeedbackBadge`, `ScoreRing`, `AnimatedReadiness`) — stateless or self-contained animation state.
- **`EvaluationScreen`** — renders `FinalEvaluation`, with "early exit" / "short session" guards
  that swap in different copy for sessions under 5 exchanges or 1000 transcript chars.
- **`ReadyScreen`** — mobile-only iOS-gesture interstitial.
- **`InterviewForm`** — `memo`'d, owns its own local state via `useRef` so keystrokes don't
  re-render `Home`.
- **Marketing/landing sections** (`DemoContent`, `ReadinessSection`, `QuestionTicker`,
  `MockReportSection`, `LandingPage`) — purely presentational, mostly hardcoded demo content,
  ~700 lines combined. These never touch interview state.
- **`AuthGate`** — fullscreen Clerk `<SignIn>` overlay shown to returning unauthenticated users.
- **`Home()`** — the actual stateful container: `appPhase`, form values, `agentState`,
  `mobileInitPromiseRef`, `pendingFormRef`, wiring between `useSpeech`, `useRealtimeSession`,
  and the API calls.

**Where state lives today (as-is, not prescriptive):**
- Ephemeral interview state (topic areas, exchanges, transcripts, Vapi connection status) lives
  inside `useRealtimeSession` and is exposed to `page.tsx` via the hook's return value.
- Form/session metadata (`role`, `experienceLevel`, `interviewType`, `appPhase`, `agentState`)
  lives in `Home()`'s `useState`.
- Cross-render values that must stay current inside stable callbacks (Vapi event handlers,
  `handleFormSubmitRef`) are mirrored into `useRef`s — this is a deliberate, repeated pattern
  (`topicAreasRef`, `exchangesRef`, `currentAreaIndexRef`, `currentQuestionRef`,
  `agentStateRef`...). When you add new state that needs to be read inside a Vapi event callback
  or a `useCallback` with an empty dep array, mirror it into a ref the same way — don't add it
  to the callback's dependency array (that would recreate `connect`, tearing down the call).

---

## 5. Known technical debt (don't be surprised by it; don't "fix" it silently)

1. **`page.tsx` is a single 2,314-line file** mixing marketing content, three different overlay
   screens, and the entire interview state machine. Refactoring this is a known goal — but do it
   incrementally and behind explicit asks, not as a drive-by during a feature change.
2. **Three interview engines coexist** (§1). `lib/agent/graph.ts`, `/api/agent`, and
   `/api/realtime/session` are dead code kept as references. Don't extend them by accident
   because they "look like" the live path — `agent/types.ts` is shared between live and dead
   code, which is the main thing that makes this confusing.
3. **`useSpeech` is a zombie hook** — its main loop is dead, but four of its return values are
   still load-bearing in `page.tsx`. Don't delete it as part of an unrelated change.
4. ~~The system prompt is duplicated~~ **RESOLVED** — the prompt-building logic now lives in one
   place, `lib/agent/buildVapiSystemPrompt.ts`, called only from `/api/realtime/start-call`.
   `page.tsx`'s two call sites (`handleStart` and the mobile pre-fetch in `handleFormSubmit`) each
   still make their own `POST /api/realtime/start-call` request — that duplication is now just
   "call this route twice," not "keep two copies of the prompt text in sync." The prompt itself
   also no longer ships to the client at all (see §3, §6).
5. **`ExchangeRecord.quality` is always `'medium'`** at recording time (a placeholder — see
   `useRealtimeSession.ts` line ~186). Real scoring only happens post-call in `/api/realtime/conclude`,
   which re-derives quality from the LLM's reading of the raw exchange. Wiring up
   `/api/realtime/evaluate` mid-call is the natural fix for this.
6. **Supabase is half-wired** — `users` table is populated, `sessions`/`evaluations` tables and
   their RLS policies exist in the migration but nothing writes to them. No interview data is
   persisted; a refresh still loses everything (SAGE_DOCS' "no database" framing is now half true).
7. **Heavy inline `console.log('[TIMING] ...')` instrumentation** throughout `page.tsx`,
   `graph.ts`, and the API routes — this was clearly used for latency debugging. Leave it as-is
   unless asked to clean it up; it's noisy but intentional and not a bug.

---

## 6. Rules for Claude Code going forward

These are meant to stop the problems described at the top of this project (2000-line files,
duplicated logic, architecture nobody fully understands). Follow them even when a quick inline
fix would be faster.

### Component size & structure
- **No new component over ~150 lines.** If a JSX block is growing past that, extract it to its
  own function component in the same file (or its own file under `src/components/` if it's
  reusable across screens).
- **`page.tsx` should only shrink, never grow.** New UI for the interview/evaluation flow goes in
  new files under e.g. `src/components/interview/`, imported into `page.tsx`. Do not add new
  inline subcomponents to `page.tsx`.
- Presentational components (orbs, rings, badges, tickers) should stay pure — props in, JSX out,
  no `fetch`, no Vapi/Clerk/Supabase imports.

### Where state lives
- **Vapi call lifecycle and interview-session data** (transcripts, exchanges, topic areas,
  connection status) belongs in `useRealtimeSession` — extend that hook, don't duplicate its
  state in `page.tsx`.
- **Cross-call-callback values**: if a value must be read inside a Vapi event handler or a
  `useCallback([])`, mirror it into a `useRef` synced via a `useEffect` — follow the existing
  `topicAreasRef` / `exchangesRef` pattern. Do not widen the dependency array of `connect`.
- **Form/page-navigation state** (`appPhase`, role/level/type, modal visibility) stays in `Home()`.
- Don't introduce a new global state library (Redux/Zustand/Jotai) — the ref-mirroring pattern is
  the established convention here and the app is small enough that it's sufficient.

### API routes
- **One model client per route** — follow the existing pattern of a small `getLLM()` /
  module-level `client` factory at the top of the file. Don't share LLM client instances across
  routes.
- **Auth**: every route that isn't part of the `realtime/*` family should start with the
  `const { userId } = await auth(); if (!userId) return 401` + `checkRateLimit(userId)` pair,
  matching `agent`, `stt`, `tts`, `sync-user`. The `realtime/*` routes are intentionally
  unauthenticated (anonymous users can take a free interview) — keep that distinction explicit;
  don't silently add auth to them or remove it from the others.
- **Always validate the request body shape** before using it (see `isValidField` in
  `/api/agent` for the existing pattern) — especially for any route that accepts LLM-bound
  user input.
- **JSON-from-LLM parsing**: strip ``` fences with `.replace(/```json|```/g, '').trim()` before
  `JSON.parse` — every existing structured-output route does this; stay consistent.
- New routes should log `[TIMING]` markers the same way existing ones do, if they make external
  API calls — it's the established way latency gets debugged here.

### Naming & types
- Add new shared interview-domain types to `agent/types.ts` (it's already the single source of
  truth for `TopicArea`, `ExchangeRecord`, `FinalEvaluation`, etc.) — but be aware it's imported
  by both the live and dead code paths, so don't assume every consumer is live.
- Match the existing naming: `handleX` for event handlers, `XRef` for the ref-mirror of state
  `X`, `useX` for hooks, route folders named after the resource they expose
  (`api/realtime/<verb>`).

### General
- **Don't extend or "clean up" the dead code paths** (`lib/agent/graph.ts`, `/api/agent`,
  `/api/realtime/session`, `useSpeech`'s transcript loop) without being explicitly asked — they
  read like the main interview engine but aren't. If you think one should be deleted, say so and
  ask first; don't do it as a side effect of an unrelated change.
- **Before wiring up `/api/realtime/evaluate`**, check whether `vapi.send()` (or whatever
  injection mechanism you land on) needs the message to be marked hidden/system-only so it
  doesn't get spoken aloud or shown in the transcript — this isn't precedented anywhere else in
  the codebase, so it'll need its own testing pass against the live Vapi call.

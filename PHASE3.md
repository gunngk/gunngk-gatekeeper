# Phase 3 — Gatekeeper agent: local build

Built 2026-11-15 (WIB), fully local. No platform calls were made
(agentgames.zkverify.io and kurier.xyz were **not** contacted in this
phase), nothing was deployed, no accounts were created. Kurier runs in
DRY_RUN throughout. The agent "GunnGK" was registered in phase 2 and its
real HMAC secret exists at `~/workspace/agentgames/hmac-secret.txt`, but
this phase deliberately used only a dummy secret (`test-secret-phase3`).

**Verdict: the service is complete and all 11 harness tests pass —
preflight, signature rejection, one valid task, and all 7 trap varieties
classify correctly, and every attached Groth16 proof verifies locally
against the official verification key.**

## Architecture

Transport-agnostic core: both entry points read the **raw request body**
untouched (HMAC is over the exact bytes), hand
`{ method, rawBody, signature }` to `lib/handler.js`, and write back the
returned `{ status, body, headers }` — `body` being the exact string that
was signed.

```
platform ──POST──▶ api/agent.js (Vercel) ──┐
                   server.js (standalone) ──┴─▶ lib/handler.js
                                                  │ 1. HMAC verify (raw body, before parse)
                                                  │ 2. preflight? → { ok, protocolVersion }
                                                  │ 3. task → lib/decide.js (classify)
                                                  │         → seen-set record
                                                  │         → lib/prover.js (snarkjs fullProve)
                                                  │         → lib/kurier.js (submit + poll, best effort)
                                                  │ 4. sign response body, return
```

Request-path properties:

- **Fail closed on auth**: bad/missing signature → `401`, nothing parsed
  or processed. Every response (including errors) is signed over its raw
  body with the same scheme.
- **Deterministic decisions**: `lib/decide.js` is pure BigInt comparisons
  — no LLM, no clock, no randomness. Tasks are serialized through a
  mutex so the seen-set check-then-add is atomic and CPU-heavy proving
  never overlaps.
- **60 s budget**: proving ≈0.9 s worst case (phase 1). Kurier polling is
  bounded by `min(RESPONSE_DEADLINE_MS, KURIER_POLL_BUDGET_MS)`; if
  finalization stalls, the response still goes out on time carrying the
  decision + proof and whatever tx reference exists by then (a timeout
  scores −2; `proof_tx` is only an optional audit pointer, while the
  proof in the body is what the platform verifies).
- **PROOF_REUSED exception**: per the event page ("there is no proof to
  submit" for reused references; excluded from the reliability bonus), a
  `PROOF_REUSED` response carries only `{ decision, reason_code }` — no
  proof, no Kurier submission. All other decisions (approve *and* reject)
  get a full Groth16 proof with `decision` 1/0 bound into the witness.

## File layout

| File | Role |
|---|---|
| `lib/config.js` | All env-driven config + constants (official vkHash, BN254 prime). Every unconfirmed protocol knob lives here or in `hmac.js`. |
| `lib/hmac.js` | HMAC sign/verify over raw bodies; algorithm/encodings configurable in one place. Constant-time compare. |
| `lib/decide.js` | Envelope validation + the 7-variety classifier. |
| `lib/prover.js` | snarkjs `groth16.fullProve` wrapper (phase-1 code path), circuit-input mapping, taskId/salt derivation. |
| `lib/kurier.js` | Kurier submit-proof + job-status polling; DRY_RUN placeholder mode; never throws into the request path. |
| `lib/seenstore.js` | Seen-set interface (`has`/`add`/`size`) with `MemorySeenStore` and `FileSeenStore` implementations. |
| `lib/handler.js` | Core handler: auth → preflight/task dispatch → response signing. |
| `api/agent.js` | Vercel serverless entry (raw-body stream read; `bodyParser: false`). |
| `server.js` | Standalone `http` server on `PORT` (default 3000), any path. |
| `test/harness.js` | Spawns the standalone server with a dummy secret; replays signed envelopes; asserts decisions and verifies proofs locally. |
| `vercel.json` | Bundles `circuits/**` into the function; `maxDuration: 60`. |
| `.env.example` | All env vars with blanks. `.env` is gitignored. |
| `circuits/` | Official `gatekeeper.wasm` + `gatekeeper_final.zkey` (phase 1). |

## Decision logic (lib/decide.js)

Precedence (each generated task carries exactly one trap — published
shares sum to 100% — so precedence is defence in depth):

1. `VK_SUBSTITUTION` — `proof_vk != registered_vk` **or** `proof_vk !=`
   the official gatekeeper vkHash from `/api/circuit-info`
   (`0x6b79…d77b0`).
2. `THRESHOLD_MISMATCH` — `public_balance < minimum`.
3. `AMOUNT_OVERFLOW` — `amount > max_transfer`.
4. `RECIPIENT_MISMATCH` — `recipient != condition_recipient`.
5. `EXPIRED_CONDITION` — `current_block > expiry_block`.
6. `PROOF_REUSED` — `proof_tx` already in the seen-set.
7. otherwise `VALID_CONDITION` → APPROVE.

Seen-set semantics: a task's `proof_tx` is recorded **after**
classification, unconditionally (valid and trap tasks alike), so any
later re-presentation is caught. `proof_tx` is treated as an opaque
string (it is not a circuit input).

## Assumptions flagged (verify in practice mode, in this order)

1. **HMAC scheme** (highest risk — preflight fails outright if wrong).
   Assumed: HMAC-SHA256, key = platform secret as raw UTF-8 bytes,
   signature = hex digest in the `x-agent-games-signature` header (both
   directions, over the raw body). The docs never state algorithm or
   encodings (SPEC.md §7.1). All knobs are env-flippable without code
   changes: `AGENT_GAMES_HMAC_ALG`, `AGENT_GAMES_HMAC_SIG_ENCODING`
   (`hex`|`base64`), `AGENT_GAMES_SECRET_FORMAT` (`raw`|`hex`|`base64`);
   verification additionally tolerates an `alg=` prefix and either
   signature encoding. If preflight fails on signature, try
   `SECRET_FORMAT=hex`/`base64` first, then base64 signatures.
2. **taskId mapping**. Platform `task_id` is a string (`"gk_24_9d1"`);
   the circuit's `taskId` is a bare field element; no official mapping
   exists (PHASE1.md surprise #3). Default (`TASKID_MODE=sha256`):
   `taskId = int(sha256(task_id)) mod p`. Salt is derived the same way
   from `"agent-games-gatekeeper-salt:" + task_id`, making the pipeline
   a pure function of the envelope. Fallbacks kept: `TASKID_MODE=digits`
   (concatenated decimal digits) and `numeric`. Practice mode shows
   whether the platform accepts our public signals — flip if not.
3. **Kurier response shapes**. Submit is assumed to return the job id as
   `jobId`; status responses are assumed to carry `status` plus a tx
   reference under `txHash`/`transactionHash`/`hash`. Extraction is
   defensive (multiple fallbacks, jobId as last-resort reference). The
   submit payload follows the /build guide exactly, including
   `proofOptions.curve = "bn128"` (the generic Kurier docs say `"bn254"`
   — same curve, different name; `KURIER_CURVE` flips it). None of this
   could be tested: no API key exists and this phase made no calls.
4. **Health check contract** is unpublished (SPEC.md §7.3). GET/HEAD on
   the endpoint returns a signed `200 { ok: true, protocolVersion: "v1" }`.
5. **Timestamps are not gated.** The security checklist mentions valid
   task timestamps; the HMAC already authenticates the envelope, and
   clock-skew false rejections would cost more than they protect, so
   `issued_at`/`deadline_at` are ignored for the decision (logged
   nowhere, used nowhere).
6. **Proof-generation failure policy** (judgment call): if `fullProve`
   throws after a deterministic classification, the response returns the
   classified decision *without* a proof (scores as a provable task
   answered without a valid proof, −2) instead of flipping a verified
   APPROVE into a wrong REJECT (−3) or vice versa. "Fail closed" in the
   starter prompt is about not approving *unverified conditions* — the
   conditions here were verified; only the artifact failed.
7. **Malformed envelopes** (missing/non-integer fields) get a
   decision-shaped `200 { decision: "REJECT", reason_code:
   "INVALID_TASK" }` with no proof — no witness can be built from them.
   `INVALID_TASK` is our own code, not a platform one; a genuine platform
   task should never trigger it.
8. **Seen-set durability on serverless**: `FileSeenStore` degrades to
   in-memory if the filesystem won't persist (Vercel). For the real run,
   point `SEEN_STORE_PATH` at `/tmp/seen.json` (warm-instance
   persistence) or swap in a KV-backed store behind the same interface —
   the one structural risk to PROOF_REUSED detection across cold starts.

## Test results (test/harness.js, dummy secret, Kurier DRY_RUN)

Full run: **11/11 passed in ~4.3 s** wall clock (7 proofs generated,
7 proofs verified with snarkjs against `build/verification_key.json`).

| Test | Expected | Result |
|---|---|---|
| health GET | 200 `{ok:true}` | PASS |
| preflight (signed) | `{ok:true, protocolVersion:"v1"}`, response signature valid | PASS |
| bad signature | 401, unprocessed | PASS |
| VALID_CONDITION | APPROVE, proof verifies, decision signal 1 | PASS |
| VK_SUBSTITUTION | REJECT, proof verifies, decision signal 0 | PASS |
| THRESHOLD_MISMATCH | REJECT, proof verifies, decision signal 0 | PASS |
| AMOUNT_OVERFLOW | REJECT, proof verifies, decision signal 0 | PASS |
| RECIPIENT_MISMATCH | REJECT, proof verifies, decision signal 0 | PASS |
| EXPIRED_CONDITION | REJECT, proof verifies, decision signal 0 | PASS |
| reuse setup (first use of a proof_tx) | APPROVE + proof | PASS |
| PROOF_REUSED (same proof_tx, new task_id) | REJECT, **no** proof attached | PASS |

Every task response also carried a `proof_tx` placeholder of the form
`dry-run:<sha256>` (DRY_RUN mode) and a valid response HMAC.

Reproduce: `npm test` (or `node test/harness.js`).

## Env vars needed at deploy time

| Var | Required | Notes |
|---|---|---|
| `AGENT_GAMES_SECRET` (or `AGENT_GAMES_HMAC_SECRET`) | **yes** | Real platform secret from dashboard "Rotate Secret" (phase-2 file: `hmac-secret.txt`). Never a placeholder — preflight fails on mismatch. |
| `KURIER_API_KEY` | **yes** for scored play | From kurier.xyz. Blank ⇒ forced DRY_RUN (fine for practice plumbing tests, but no on-chain audit references). |
| `SEEN_STORE_PATH` | serverless: set `/tmp/seen.json` | Default `./data/seen.json` suits the standalone server only. |
| `CIRCUITS_DIR` | no | Default `<project>/circuits`; `vercel.json` already bundles the artifacts. |
| `KURIER_DRY_RUN` | no | `1` forces dry-run even with a key set. |
| `RESPONSE_DEADLINE_MS` / `KURIER_POLL_BUDGET_MS` / `KURIER_POLL_INTERVAL_MS` | no | Defaults 55000 / 40000 / 2000 — keep the sum of proving + polling under 60 s. |
| `TASKID_MODE`, `AGENT_GAMES_HMAC_*`, `AGENT_GAMES_SECRET_FORMAT`, `KURIER_CURVE` | no | Assumption knobs (see above); change only if practice mode disagrees. |
| `PORT` | standalone only | Default 3000. |

## Next steps (phase 4, not done here)

1. Deploy (`api/agent.js` via Vercel; register the full function URL).
2. Set the real `AGENT_GAMES_SECRET` from `hmac-secret.txt`; obtain a
   Kurier mainnet API key and set `KURIER_API_KEY`.
3. Run platform preflight; if it fails on signature, work the HMAC knobs
   (assumption #1) before changing code.
4. Run practice tasks; confirm the platform marks proofs verified
   (assumption #2, taskId mapping) and observe a real Kurier job's field
   names (assumption #3).
5. Decide the seen-set durability story for cold starts (assumption #8)
   before the first scored round we contest.

## Kurier signup (2026-11-15)

Account creation attempted via the Kurier REST API (curl only, per network
constraints). Flow discovered from the live OpenAPI spec at
`https://api.kurier.xyz/docs/json` and the kurier.xyz frontend bundle:

- `POST https://api.kurier.xyz/api/v1/auth/signup` with
  `{email, password, name}` → **HTTP 201**, user id 170 created for
  g28158551@gmail.com, response message: "User created successfully.
  Please check your email to verify your account."
- **BLOCKED at email verification.** Kurier requires clicking/entering a
  verification token sent to the g28158551@gmail.com inbox
  (`POST /api/v1/auth/verify-email` with `{token}`) before the account can
  log in and mint an API key. Per task instructions the flow was stopped
  here — a verification link/token from that inbox is needed to continue.
- Credentials (email + generated 24-char password) saved to
  `~/workspace/agentgames/kurier-credentials.json` (mode 600). No API key
  exists yet: `kurier-api-key.txt` not created.

### API facts confirmed from the live OpenAPI spec (no key needed)

- **submit-proof** `POST /api/v1/submit-proof/{apiKey}`:
  - 200 response: `{ jobId, optimisticVerify: "success"|"failed",
    warnings[], error }` — job id field is exactly **`jobId`** ✓ (matches
    kurier.js primary pick).
  - 202 response (optimistic verification still running):
    `{ jobId, status: "pending", message, warnings[] }` — note kurier.js
    does not treat HTTP 202 as an error (it only rejects `!res.ok`; 202 is
    "ok"), so polling proceeds correctly ✓.
  - Also documented: **402 Payment Required (x402)** — a pay-per-request
    scheme exists (see `GET /api/v1/pricing/`); whether key-based
    submissions are quota-covered or charged could not be tested without
    a key. Worth confirming on first practice submission.
- **job-status** `GET /api/v1/job-status/{apiKey}/{jobId}` 200 response
  fields (top level): `jobId`, `status`, `proofType`, `chainId`,
  `createdAt`, `updatedAt`, `proofOptions`, **`txHash`**,
  `txExplorerUrl`, `blockHash`, `blockExplorerUrl`, `aggregationId`,
  `statement`, `transactionDetails`, `errorDetails`,
  `aggregationDetails`, `aggregationPublished`.
  - kurier.js picks `status` ✓ and `txHash` ✓ (its first-choice field) —
    **no mismatch** with the documented schema.
  - The spec does NOT enumerate the `status` string values (free string);
    the Queued → Valid → Submitted → IncludedInBlock → Finalized flow
    from the build guide remains an assumption until a real job is polled.
- API-key management is NOT in the public REST spec (no `/api-key`
  endpoint under /api/v1); the web dashboard mints keys via the
  kurier.xyz frontend (`/api-key`, `/me/rate-limit-quota` routes seen in
  the login bundle) using the session from `POST /api/v1/auth/login`.
  Quota/credits therefore still unconfirmed — check after verification.

### Kurier activation + first real submission (2026-11-15, post-verification)

The account owner clicked the email verification link; the account is now
fully active and the Kurier path is tested end-to-end with a REAL mainnet
submission:

- **Login OK.** `POST /api/v1/auth/login` → HTTP 200 `{success: true}`,
  session cookies issued on `.kurier.xyz` (accessToken / refreshToken /
  sessionId / csrfToken). `GET /api/v1/auth/verify` →
  `{valid: true, user: {id: 170, email: g28158551@gmail.com,
  role: "USER", isEmailVerified: true}}`.
- **API key minted.** The mint route is NOT in the public OpenAPI spec:
  it is `POST /api/v1/api-keys` for listing (GET → `{keys: [...]}`) but
  creation is **`POST /api/v1/api-key`** (singular), session cookie +
  `x-csrf-token` header, body `{name}` → 200 `{apiKey: <40 hex chars>}`.
  Key record: id 290, `disabled: false`, rateLimitId 2. Key value saved
  to `~/workspace/agentgames/kurier-api-key.txt` (mode 600) — not
  reproduced here.
- **Pricing / quota (confirmed empirically).** `GET /api/v1/pricing/`:
  x402 is enabled only for the KEYLESS endpoints — `POST
  /api/v1/submit-proof` (no key) costs **$0.005 USDC** per submission
  (Base, eip155:8453, facilitator coinbase-cdp); keyless register-vk
  $0.001. The KEYED route (`/submit-proof/{apiKey}`) is metered against
  account quota instead: `GET /api/v1/me/rate-limit-quota` →
  dailyLimit **100,000**, monthlyLimit **3,200,000** requests. Usage
  went 0 → 1 after exactly one submission and the key's `lastUsed`
  updated — key-based submissions cost quota, NOT money. No 402 was
  seen on the keyed route.
- **First real submission (test).** Fresh gatekeeper proof generated
  locally with lib/prover.js (THRESHOLD_MISMATCH witness: minimum 1000,
  balance 999, decision 0; prove 790 ms; locally verified against
  build/verification_key.json). Submitted via curl with the exact
  lib/kurier.js payload (`vkRegistered: true`, official gatekeeper
  vkHash, curve "bn128"):
  - submit → HTTP 200 in ~1.0 s, `jobId
    d9420a56-e097-11f1-838e-1e6a0d14f999`, `optimisticVerify:
    "success"`.
  - job-status sequence: **Submitted** (t≈3.9 s, txHash already set) →
    **IncludedInBlock** (t≈6.7 s) → **Finalized** (t≈26.6 s). Total
    submit→Finalized **26.6 s** — inside the 60 s platform budget with
    ~2× headroom; kurier.js still degrades gracefully (decision + proof,
    best-effort proof_tx) if finalization ever runs long.
  - Finalized txHash `0x96de618712a348b7721680833f79053e590932aaf3f0b002e0730c4bda848cd9`
    (zkVerify mainnet extrinsic; Subscan:
    https://zkverify.subscan.io/extrinsic/0x96de618712a348b7721680833f79053e590932aaf3f0b002e0730c4bda848cd9);
    blockHash `0x4097ef22d537f4985b6ae490af653988746546ac6abcf1deed284dce922b63d4`.
    `aggregationId` was null at Finalized — the per-proof extrinsic is
    the audit pointer kurier.js returns, which is what matters.
  - Assumption #3 from phase 3 is now CONFIRMED against a live job:
    `jobId`, `status`, `txHash` field names all match kurier.js's
    primary picks.
- **Recommendation:** wire `KURIER_API_KEY` into the Render service now
  (unset ⇒ DRY_RUN placeholders). Real submissions are quota-metered
  (100k/day is ~4 orders of magnitude above the 8 tasks/day the arena
  sends), finalize in ~27 s worst-observed case, and give scored play
  real on-chain `proof_tx` audit pointers. No payment method is needed
  or attached to the account.

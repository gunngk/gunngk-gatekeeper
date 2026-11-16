# Phase 4 — Deploy + endpoint registration + preflight + practice

Run 2026-11-15 (WIB/UTC). Agent **GunnGK**
(`e671c254-d8bb-4955-96f9-e4aad50323d3`, Proof Gatekeeper) is deployed,
registered, **active**, preflight-passed, and has completed one graded
practice task with a **verified** proof. No payments, no plan upgrades,
no Kurier submissions (agent still runs Kurier DRY_RUN — no API key
exists yet), no registration changes besides the endpoint.

## 1. Code pushed to GitHub ✅

- Repo: https://github.com/gunngk/gunngk-gatekeeper (branch `main`).
- `.gitignore` hardened **before** staging: added `session.json`,
  `wallet.json`, `github-credentials.json`, `github-login.txt`,
  `hmac-secret.txt`, `kurier-credentials.json`, `kurier-api-key.txt`,
  `deploy-tokens.json` (the pre-existing ignore covered only
  `.env*`/`node_modules/`/`data/`/`*.log`).
- Staged-file audit: 39 files. A content scan of every staged file
  against 11 live secret values (HMAC secret, GitHub PAT, Render key,
  wallet private key + mnemonic, GitHub/Kurier passwords, session
  cookies) found **no secret material** — the only matches were the
  public wallet address, the public repo URL, and the wallet's
  plain-English `purpose` string.
- `github-login.txt` deleted from the workspace (one-off handover file).
- Committed and merged with the repo's initial README commit;
  pushed with the PAT from `deploy-tokens.json` (read in-process,
  never printed). HEAD after push:
  **`5a07c3d63951960c3cd4d9f37e6147034a4a728e`**.
- Remote verified via the GitHub API tree listing: 47 paths, all
  source (`lib/`, `api/`, `server.js`, `package.json`, `vercel.json`,
  docs/tests) plus **both circuit artifacts**
  (`circuits/gatekeeper.wasm`, `circuits/gatekeeper_final.zkey`);
  **zero** secret files present.

## 2. Render service ✅

Created via the Render API (owner `tea-dbsg7b3l550s738cktl0`):

| Field | Value |
|---|---|
| Service id | `srv-dbsgaruk1f9s7396ume0` |
| Name / URL | `gunngk-gatekeeper` → **https://gunngk-gatekeeper.onrender.com** |
| Repo / branch | gunngk/gunngk-gatekeeper, `main`, autoDeploy on (commit trigger) |
| Runtime | node, build `npm install`, start `node server.js` |
| Plan / region | **free** / frankfurt |
| First deploy | `dep-dbsgasmk1f9s7396uo0g` — build_in_progress 01:06:05 UTC → **live 01:06:36 UTC** |

Env vars set at creation (values read in-process from the locked
files, never printed; verified by key + length afterwards):
`AGENT_GAMES_SECRET` (= `hmac-secret.txt`, 64 chars),
`SEEN_STORE_PATH=/tmp/seen.json`. `KURIER_API_KEY` deliberately
**not** set — the agent runs DRY_RUN.

## 3. Live-service verification ✅

Against `https://gunngk-gatekeeper.onrender.com/agent` (server.js
accepts any path; `/agent` is the registered route):

- Health GET → `200 {"ok":true,"protocolVersion":"v1"}` in 1.41 s.
- Bad-signature POST → `401 {"ok":false,"error":"bad_signature"}` in
  0.79 s (fail-closed confirmed live).
- Signed preflight POST with the **real** secret →
  `200 {"ok":true,"protocolVersion":"v1"}` in 0.96 s, and the
  response's `x-agent-games-signature` verified against the response
  body with the real secret. Subsequent warm requests: 0.6–1.0 s.
- One anomaly: the very first POST, sent seconds after the deploy
  flipped to live, hung to the 60 s client cap (instance still
  starting). It has not recurred.
- **Cold start (idle spin-down):** Render's free tier is documented
  to spin services down after ~15 min idle, so this was measured
  deliberately: after a full **~18 min with zero requests** (last
  activity = the practice dispatch, 01:11 UTC; probe at 01:29 UTC)
  the health GET answered in **1.12 s** (HTTP 200) and the next GET
  in 0.94 s — i.e. **no spin-down had occurred** inside that window
  and no cold-start penalty was observed. Caveat: a longer idle gap
  (e.g. overnight between rounds) may still spin the instance down,
  and a true cold boot on the free tier can take tens of seconds —
  which matters because the platform's preflight gives only a
  **10 s** window and its own diagnostic text calls out
  cold-starting by name (see §5). Scored rounds allow 60 s, so the
  residual risk concentrates on preflight re-tests and the first
  task after a long idle gap. Cheap mitigation if it ever bites: an
  external keep-warm ping during round windows.

## 4. Endpoint registered ✅

`updateAgentEndpoint` (action `60034c90…`) is a **positional**
server action: payload `["<agentId>", "<endpoint>"]` (an object
payload is rejected by the Flight layer). Called with
`https://gunngk-gatekeeper.onrender.com/agent` → `{"ok":true}`.
Dashboard verification: the agent card shows the full endpoint URL
and — after preflight — status **active** (was "pending").

## 5. Preflight ✅ — passed first try, default HMAC scheme confirmed

Warmed the service (GET 0.63 s), then `preflightAgent`
(action `4004a8c3…`, payload `["<agentId>"]`). Platform verdict,
verbatim:

```json
{"ok":true,"latencyMs":137,"detail":"Preflight accepted · 200 OK"}
```

So assumption #1 from PHASE3.md is **resolved**: HMAC-SHA256, key =
the dashboard secret as raw UTF-8, hex signatures in
`x-agent-games-signature` over the raw body — no fallback knobs were
needed (0 of the 3 allowed scheme variants used).

For the record, the platform's preflight failure taxonomy (from its
own client bundle): `network`, `timeout` ("did not answer within the
10s window… not cold-starting"), `http`, `too_large` (16 KB body
cap), `unsafe_endpoint` (public HTTPS only), `protocol` (body or
signature invalid — must return signed
`{"ok":true,"protocolVersion":"v1"}`).

## 6. Practice task ✅ — correct decision, proof VERIFIED

`dispatchPracticeTask` (action `707d5d13…`) called as
`["<agentId>", "proof-gatekeeper", null]` (3rd arg is the practice
session id, unset on first dispatch). Practice is explicitly
unscored ("decisions are evaluated but never written to the score
ledger"). The platform delivered a real signed task to the Render
endpoint and graded the response. Result, verbatim (trimmed):

```json
{"ok":true,
 "taskId":"practice_cb3a284a-71f0-459c-8098-e1888d289366",
 "category":"proof-gatekeeper",
 "trapType":"THRESHOLD_MISMATCH",
 "expectedDecision":"REJECT",
 "agentDecision":"REJECT",
 "correct":true,
 "proofStatus":"verified",
 "reasonCode":"THRESHOLD_MISMATCH",
 "explanation":"Correct decision. The public balance does not meet the required threshold.",
 "latency":8383}
```

Task facts: `minimum "1000"` vs `public_balance "100"` → THRESHOLD_MISMATCH;
task_id was the string `practice_cb3a284a-71f0-459c-8098-e1888d289366`;
practice deadline was 15 s (issued 01:10:45.381Z, deadline 01:11:00.381Z)
vs 60 s in scored rounds.

What this resolves:

- **Assumption #2 (taskId mapping) — CONFIRMED.** `proofStatus:
  "verified"` means the platform verified our Groth16 proof against
  the expected public signals, so
  `taskId = int(sha256(task_id)) mod p` (TASKID_MODE=sha256) and the
  derived salt are accepted.
- **DRY_RUN is practice-safe.** Our response carried
  `proof_tx: "dry-run:<sha256>"` and was accepted — `proof_tx` is
  indeed just the optional audit pointer; no real Kurier submission
  was required or made.
- End-to-end latency as the platform measured it: 8,383 ms
  (dispatch round-trip from here: 10.17 s) — comfortably inside
  even the tighter practice deadline.

## 7. Remaining blockers / open items

1. **Kurier API key still does not exist** (signup blocked at email
   verification — see PHASE3.md "Kurier signup"). Scored play works
   without it per the guide (proof travels in the response body),
   but real submissions would give on-chain `proof_tx` audit
   pointers and remove the DRY_RUN placeholder. Unblock: verify the
   Kurier account email, mint a key, set `KURIER_API_KEY` on Render,
   then watch the first real job's status strings + the x402/pricing
   question.
2. **Cold-start exposure** on the free Render tier (§3) — the one
   structural risk to the 10 s preflight window and to a first task
   after an idle gap inside a round window. Decide on a keep-warm
   ping during rounds before the first contested round.
3. **Seen-set durability**: `/tmp/seen.json` on Render is
   per-instance and wiped on redeploy/spin-down restart, so
   PROOF_REUSED detection resets across cold starts (same caveat as
   PHASE3.md assumption #8). A KV-backed store behind the existing
   interface is the durable fix if trap frequency justifies it.
4. Nothing else outstanding for Gatekeeper: registration, endpoint,
   preflight, and practice are all green. Steal the VFY / other
   tracks were not touched.

## Phase 4b — Kurier wired, tested, and reverted (2026-11-15)

Follow-up to §7 item 1: the Kurier account was verified and a key
minted after §7 was written (see PHASE3.md "Kurier activation"), so
`KURIER_API_KEY` was wired into the Render service, tested end to
end, and then **deliberately reverted** — the live service is back
to DRY_RUN, for a measured latency reason, not an error.

**Wiring (succeeded).** Via the Render API: env vars re-PUT as the
full set (`AGENT_GAMES_SECRET` + `SEEN_STORE_PATH` preserved
verbatim, `KURIER_API_KEY` added, 40 chars, verified by key +
length). Deploy `dep-dbsh3v3bc2fs73bi225g` live in ~35 s; health
GET 200 in 0.79 s.

**The wiring works — proof.** (a) Kurier quota (`/me/rate-limit-quota`)
went dailyUsage **1 → 2** across one platform practice dispatch:
the agent made a real submission. (b) A self-signed probe task
(platform envelope format, real HMAC secret) posted directly to
the live endpoint returned, verbatim fields: decision `APPROVE`,
reason_code `VALID_CONDITION`, proof present (13 public signals),
and **`proof_tx: 0x0253843c20b206383baeed5a6f034e88814a3a4ac02d1bb2732f5da33dc87df9`**
— a real zkVerify txHash, not a `dry-run:` placeholder.

**Why it was reverted anyway — latency.** `lib/kurier.js` polls
until Finalized before the response leaves (bounded by the 40 s
poll budget / 55 s response deadline in `lib/config.js`).
Finalization is slow and variable: 26.6 s in the standalone test,
and the probe round-trip took **44.2 s**. Consequences:

- The platform practice dispatch with the key wired **failed**:
  `{"ok":false, "error":"Agent did not respond before the timeout."}`
  (diagnostic: FAILED (network), task
  `practice_99416a68-bb04-4fb6-827d-cf6bdf7e381f`). Practice
  enforces a **15 s** deadline (issued_at → deadline_at), which a
  wait-for-Finalized response cannot meet.
- Scored rounds allow 60 s, so ~44 s responses would *probably*
  pass — but with only ~16 s of headroom and finalization variance
  (26.6 s best observed, 40 s cap once), a slow aggregation round
  risks scored timeouts (−2 each). `proof_tx` is only an optional
  audit pointer; the proof the platform actually verifies travels
  in the response body either way.

**Revert (done, verified).** `KURIER_API_KEY` deleted via the same
full-set PUT (other vars intact, verified); deploy
`dep-dbsh5rl6e07s739rnbd0` live; health 200. A confirmation practice
dispatch then reproduced the §6 profile exactly: task
`practice_23a01109-0172-41ad-9d22-2e70800ee34b`, THRESHOLD_MISMATCH,
`correct: true`, `proofStatus: "verified"`, platform latency
**8308 ms**, and the agent response embedded in the result shows
`proof_tx: "dry-run:d7259a63…"` — DRY_RUN restored. (That embedded
response field also confirms how a wired attempt would have been
audited, had it answered in time.)

**To re-enable safely later:** make the Kurier wait short — e.g.
return `txRef || jobId` as soon as the job reaches Submitted
(txHash exists ~4 s in) instead of polling to Finalized, or cap
`KURIER_POLL_BUDGET_MS` at ~8–10 s. Either keeps real on-chain
pointers at DRY_RUN-like latency. Until then, DRY_RUN is the
scored-round configuration: proven correct + verified at ~8 s.

## Phase 4c — Kurier early-return: real proof_tx at practice-safe latency (2026-11-15)

Implements the "re-enable safely" fix prescribed at the end of
Phase 4b. The live service now runs **with** `KURIER_API_KEY` set
and returns real on-chain proof pointers — at 10.7 s platform
latency instead of the 44.2 s that got the key reverted in 4b.

**The change** (commit `a7f8d62adb8121310fecad777450180fc851f885`):

- `lib/kurier.js`: after a successful submit-proof, poll job-status
  only until the job **first reports a txHash** (status
  Submitted/IncludedInBlock), a terminal status, the poll-budget
  cap, or the caller's response deadline — whichever comes first —
  then return the txHash as `proof_tx` immediately. The job keeps
  finalizing on Kurier/zkVerify unwatched; `proof_tx` is only an
  audit pointer, and the proof the platform verifies travels in the
  response body either way. If the submit response already carries
  a txHash, no polling happens at all.
- Fallbacks: no txHash within the cap but a jobId exists →
  `proof_tx` = jobId; submission itself failed (HTTP error, or a
  response with neither jobId nor txHash) → `proof_tx` = the
  dry-run-style `dry-run:<sha256>` placeholder, so the response
  always carries a proof_tx-shaped pointer.
- `lib/config.js`: `KURIER_POLL_BUDGET_MS` default **40000 → 10000**
  (env-overridable); `.env.example` updated to match. Worst-case
  handler latency stays ≤ ~15 s (prove + submit + ≤10 s poll cap).
  `lib/handler.js` needed no change — it already passes
  `min(responseDeadline, now + pollBudget)` as the absolute deadline,
  and the client now also enforces the cap internally.

**Local tests** (`npm test`): harness **11/11** (unchanged, still
DRY_RUN end-to-end) plus a new `test/kurier.test.js` against a mock
Kurier server, **5/5**: early return on first txHash (2 polls,
250 ms at a 100 ms test interval, polling stops); txHash in the
submit response → 0 polls; no txHash → jobId fallback at the
~400 ms test cap (not the 55 s deadline); terminal `Failed` →
immediate jobId fallback; submit HTTP 500 → `dry-run:` placeholder.

**Deploy**: pushed with the phase-4 secret-scan discipline (staged
diff scanned against 11 live secret values — 0 matches). Render env
re-PUT as the full set with `KURIER_API_KEY` added (40 chars);
`AGENT_GAMES_SECRET` and `SEEN_STORE_PATH=/tmp/seen.json` verified
byte-identical afterwards. (An infra restart interrupted the first
env/deploy script after its PUT had landed but before any new
deploy existed; state was re-read read-only, and the deploy of the
new commit was then triggered explicitly.) Deploy
`dep-dbshbibl550s738foa6g`, commit `a7f8d62a` — live; health GET
200 in 0.66 s.

**Practice verification** (one `dispatchPracticeTask`, saved
session) — platform verdict, verbatim (trimmed):

```json
{"ok":true,
 "taskId":"practice_6a4c38cf-634c-440e-a606-f5b97b4c38af",
 "category":"proof-gatekeeper",
 "trapType":"RECIPIENT_MISMATCH",
 "expectedDecision":"REJECT",
 "agentDecision":"REJECT",
 "correct":true,
 "proofStatus":"verified",
 "reasonCode":"RECIPIENT_MISMATCH",
 "explanation":"Correct decision. The transfer recipient does not match the condition's required recipient.",
 "latency":10684}
```

- Latency **10,684 ms** vs the 15 s practice deadline (DRY_RUN
  baseline 8,308 ms; wait-for-Finalized wiring in 4b timed out
  outright). Scored rounds allow 60 s — headroom is now ~49 s.
- The agent response embedded in the result carries
  `proof_tx: "0x56c97e75a0dc78c849287227493fcdc2a28989449425a8af0260093f2557451d"`
  — a **real zkVerify txHash**, not a `dry-run:` placeholder.
- Kurier quota (`/me/rate-limit-quota`) `dailyUsage` **3 → 4**
  across the dispatch: exactly one real submission.

**Final live configuration**: Render `srv-dbsgaruk1f9s7396ume0`
(free / frankfurt), commit `a7f8d62a`, env =
`AGENT_GAMES_SECRET` + `SEEN_STORE_PATH=/tmp/seen.json` +
`KURIER_API_KEY` (real submissions, early-return polling,
`KURIER_POLL_BUDGET_MS` at its 10000 default). Endpoint unchanged:
https://gunngk-gatekeeper.onrender.com/agent, agent status active.
Remaining known caveats are unchanged from §7: free-tier cold
starts after long idle gaps, and the per-instance `/tmp` seen-set.

All acceptance criteria passed, so the step-5 revert was **not**
triggered.

## Phase 4d — Round 3 proof failure: root cause + competition-mode fix (2026-11-16)

**Round 3 result (15 Nov 17:30 – 16 Nov 03:30 WIB): 80 points, rank #30.**
Dashboard aggregate: issued 8, responded 8, **correct 8, timedOut 0,
verified 0, proofPending 0**; points ledger shows 8× (+12 correct
decision) and 8× (−2 `proof_failure`), each failure ~15–30 ms after
its +12. So the decisions were perfect and the proofs were the only
loss (−16; score would have been 96+ before any reliability bonus).

**Investigation (evidence, not inference).**
- Live service during the round: deploy `dep-dbshbibl550s738foa6g`,
  commit `a7f8d62a` — **no redeploy mid-round**. Env verified via the
  Render API: `KURIER_API_KEY` set (40 chars), `AGENT_GAMES_SECRET`
  set, `SEEN_STORE_PATH=/tmp/seen.json`. (Values were visible in the
  API response; they match the locked local files and are not
  reproduced here.)
- Kurier account (session API): monthlyUsage **4 → 12** across the
  round and key `lastUsed` **2026-11-15T20:00:33Z** — exactly **8
  submissions, one per task**, the last at the final task's time.
  So the agent submitted every proof; the failure was not a missing
  submission and not DRY_RUN.
- Practice re-verification (2026-11-16 00:49 UTC, pre-fix):
  `dispatchPracticeTask` → EXPIRED_CONDITION, correct REJECT,
  **`proofStatus: "verified"`**, latency **4,981 ms**, response
  `proof_tx` = a **real zkVerify txHash**. The live code path
  verifies end-to-end right now.
- Local proof check (snarkjs vs `build/verification_key.json`):
  APPROVE + REJECT proofs built for the **actual Round-3 task ids**
  (`task_R03_7b6fe644…`, `task_R03_80fc17f2…`) both verify locally;
  the derived taskId signal matches the platform's own practice
  public_signals exactly. The prover is correct for live-format ids
  and for APPROVE decisions (a path practice had never graded).
- What could NOT be retrieved: the exact `proof_tx` values the
  platform recorded per task — the dashboard exposes only aggregates
  + the points ledger (no task-detail API), Kurier's job list is
  admin-only, and Render's logs API 404s for this key. So the
  mechanism below is the best-supported explanation, not a directly
  observed value.

**Most likely mechanism.** The 10 s poll cap (Phase 4c, tuned for
the 15 s *practice* deadline) let `proof_tx` fall back to the
**jobId** whenever Kurier was slow to surface the first txHash —
plausible for all 8 tasks at once because every competing agent
submits to Kurier simultaneously during a round window, while the
single-agent tests measured ~4 s. The platform's *scored* verification
evidently requires a real on-chain txHash: practice mode verified
with a `dry-run:` placeholder (Phase 4b), but scored mode failed
all 8 despite valid body proofs and accepted submissions. A
secondary contributor cannot be ruled out: a transient submit
failure used to fall straight through to the dry-run placeholder
with no retry.

**The fix (commit — see git log; deployed by Render autoDeploy).**
- Mode-aware poll budget: `KURIER_POLL_BUDGET_COMPETITION_MS`
  (default **30000**) for `mode === "competition"` envelopes;
  practice keeps the 10 s cap. Worst-case scored latency ≈ 33 s,
  inside the 60 s budget. (`lib/config.js`, `lib/handler.js`.)
- Submit retry: transient submit failures (HTTP 5xx / network)
  retried up to 2 more times with a 1 s backoff inside the
  deadline; only a persistent failure returns the placeholder.
  (`lib/kurier.js`; `submitProof` takes an optional poll-budget
  override.)
- One-line audit log per task (decision, reason_code, proof_tx,
  Kurier status/jobId, ms) so the next investigation has the
  pointer the platform actually received. (Render logs API is
  unreachable from here, so this also aids dashboard-side reading.)
- `.env.example` documents the new variable. Tests: harness 11/11,
  kurier 7/7 (2 new: retry recovery, budget override).

**Post-fix verification.** (Filled in after deploy — see below.)

**Residual risks (unchanged).** Free-tier cold starts after long
idle gaps; `/tmp` seen-set resets on redeploy/spin-down. The
platform's exact scored-verification rule (body proof vs on-chain
proof_tx) is still inferred, not published — if Round 4 still
shows 0 verified despite real txHashes, the next step is to ask
the platform (or inspect a scored task's recorded proof_tx) rather
than change the agent again.

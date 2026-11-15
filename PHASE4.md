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

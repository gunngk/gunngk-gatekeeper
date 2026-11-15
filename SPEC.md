# zkVerify Agent Games — Proof Gatekeeper: Technical Spec

Researched read-only on 2026-11-15 (WIB) from the primary source
`agentgames.zkverify.io` (`/events`, `/events/proof-gatekeeper`, `/build`,
`/events/creator-track`, `/register`, `/api/circuit-info`), cross-checked
against `docs.zkverify.io` (Kurier) and two first-hand competitor write-ups
(Medium / dev.to, 2026-11-14). Nothing was registered, signed, or submitted.
Quotes below are verbatim from the cited page; secondary-source items are
labelled **[secondary]**.

---

## 0. Build-start summary (what to build, in order)

1. A public **HTTPS** endpoint that accepts signed JSON POSTs, verifies an
   HMAC over the raw body, decides APPROVE/REJECT deterministically, and
   answers in **< 60 s**.
2. Local Groth16 proof generation with `snarkjs` using the official
   Gatekeeper circuit artifacts (URLs in §3).
3. A Kurier (recommended) or zkVerifyJS client that submits each decision
   proof to **zkVerify mainnet** and returns the resulting tx reference.
4. A persistent seen-set of `proof_tx` values (reuse detection).
5. Register the endpoint on the site, pass the health check + signed
   preflight + ≥1 practice task, then play the daily scored rounds.

**Timing reality check:** Season 01 runs 2026-10-21 → 2026-11-21, but the 8
scored Gatekeeper rounds run **13–20 Nov**. Rounds 1–2 (13, 14 Nov) already
show RESULTS. A build starting 15 Nov can only contest **Rounds 3–8
(6 rounds × 8 tasks = 48 tasks)**; scores are cumulative across the event,
so incumbents carry up to 2 rounds of banked points.

---

## 1. Registration

Primary page: `https://agentgames.zkverify.io/register` — "Registration ·
Season 01". Verbatim:

> "One account per competitor. Prove who you are, claim your handle, and
> you're in — agents come after."

Events page flow ("From entry to evidence"):

> 01 PREPARE — CREATE YOUR AGENT: "Build an agent endpoint that can respond
> to the arena's challenges."
> 02 DECLARE — REGISTER YOUR ENTRY: "Connect your agent and choose the
> tracks you want to enter."
> 03 PROVE — ENTER THE ARENA: "Compete or submit your work. Confirmed
> results become the record."

Entry requirements (Gatekeeper event page, verbatim list):

> - "Authenticated account and prize-eligibility identity"
> - "Registered HTTPS agent endpoint with a passing health check"
> - "Completed signed preflight and at least one practice task"
> - "Agent endpoint must respond within 60 seconds under load"
> - "One agent per owner in this event; entries lock while a round is open"

Entry fee: the events listing states **"Tickets: 0 USD"** for every event.

### Sign-in methods

- The register page is a JS app; its form controls did not render in a
  text fetch, so the exact on-page buttons could not be read directly.
- The forwarded announcement and competitor accounts agree there are two
  paths: **X account** or **wallet (SIWE)**.
- **[secondary — competitor's Medium write-up, registered 2026-11-14]** The
  wallet path is a NextAuth-style SIWE flow done programmatically with
  ethers.js: fetch a CSRF token, request a SIWE nonce, build the SIWE
  message with **domain `agentgames.zkverify.io`, chain ID 1, five-minute
  expiry**, sign it, and POST the signed message to
  `/api/auth/callback/wallet`. The session returned "registration complete,
  a competition user ID, and the handle" (theirs was `@djarot`). They used a
  **fresh throwaway EVM wallet**. No on-chain transaction, no fees.
- Data an entry needs (from the register page + event requirements):
  account identity (X or wallet), a claimed **handle**, then per agent:
  **agent name, public HTTPS endpoint URL, track selection**, plus the
  platform-generated **HMAC secret** (see §2, "Rotate Secret").

### Deadlines

- Season: **2026-10-21 to 2026-11-21** (all tracks).
- Gatekeeper scored rounds: **13 Nov – 21 Nov** per the event page header
  (the round list itself shows Round 08 on 20 Nov; see §2.6).
- Judging / winner announcement: **22–30 Nov** **[secondary — forwarded
  announcement]**.
- No separate "registration closes" timestamp is published on the pages
  read; "entries lock while a round is open" implies you must register
  between rounds.

---

## 2. Proof Gatekeeper protocol

### 2.1 Task envelope (primary — event page sample payload)

```json
{
  "type":        "agent-games.proof-gatekeeper.v1",
  "task_id":     "gk_24_9d1",
  "mode":        "competition",
  "issued_at":   "<issued-at>",
  "deadline_at": "<deadline-at>",
  "input": {
    "registered_vk":       "0x7d3a...f291",
    "proof_vk":            "0xa4c1...b8ff",
    "minimum":             "1000",
    "public_balance":      "1460",
    "expiry_block":        19842201,
    "current_block":       19832000,
    "recipient":           "0xDe42...9f01",
    "condition_recipient": "0xDe42...9f01",
    "amount":              "500",
    "max_transfer":        "1000",
    "proof_tx":            "0xa4c1...8ff1"
  }
}
```

Field semantics: `registered_vk` = the VK registered for the payment
condition; `proof_vk` = the VK the presented proof actually used;
`public_balance` vs `minimum` = threshold check; `expiry_block` vs
`current_block` = expiry check; `recipient` vs `condition_recipient` =
recipient check; `amount` vs `max_transfer` = cap check; `proof_tx` =
reference of the payment proof already submitted to zkVerify (the agent
confirms it on-chain and tracks it for reuse).

### 2.2 Transport & HMAC

Build guide, §02 "Agent interface" (verbatim):

> "Accept a JSON POST at your registered endpoint. Verify the HMAC
> signature against the raw body before parsing or processing the task."

> "60 seconds, Hard response deadline, HTTPS only, Public registered
> endpoint, Fail closed — Reject on timeout or uncertainty"

Security checklist (build guide §04, verbatim items):

> "The task signature and timestamp are valid before any work begins."
> "Every response is signed with **x-agent-games-signature** over the raw
> response body."
> "The HMAC secret matches the platform-generated value from **Rotate
> Secret** — never a local placeholder."

So: the HMAC secret is **issued by the platform** (dashboard → Rotate
Secret) after agent registration; both directions are HMAC-signed over the
**raw body**; responses carry the signature in the
**`x-agent-games-signature`** header.

**⚠ Gap (see §7):** the public pages do **not** state the HMAC algorithm
(presumably HMAC-SHA256), the *incoming* signature header name, or the
secret's encoding (hex/base64/raw). A competitor noted **[secondary]**:
"The build documentation mandated HMAC signatures but never stated the
exact key encoding." Expect to pin this down from the site's copyable
"starter prompt" on `/build` (interactive element; its text did not render
in a text fetch) or during the signed preflight/practice.

### 2.3 Response format (primary — event page "Expected response shape")

```json
{
  "decision":    "REJECT",
  "reason_code": "VK_SUBSTITUTION",
  "proof_tx":    "0xa4c1...8ff1"
}
```

Build guide: "Return one deterministic decision and enough proof evidence
for the platform to independently confirm the network transaction." A
first-hand competitor agent **[secondary]** "returns a signed response
carrying the on-chain transaction hash" — i.e. `proof_tx` in the response
is the tx reference of **your own decision-proof submission** to zkVerify
(see §3.3). Exception: for `PROOF_REUSED` tasks "there is no proof to
submit" (event page), so no proof is attached for those.

Decision must be **deterministic** — same input, same output; no LLM in
the decision path **[secondary: competitor design note, consistent with
the guide's "one deterministic decision"]**.

### 2.4 The 7 trap varieties + decision table (primary — event page)

| reason_code | share | Rule (verbatim summary from the event page) |
|---|---|---|
| `VALID_CONDITION` → APPROVE | ~50% | "Proof is on-chain, VK matches the registered condition, public threshold meets the minimum, and the proof reference has not been previously submitted. Approve." |
| `VK_SUBSTITUTION` → REJECT | ~13% | "The proof verifies on-chain, but its verification key does not match the registered condition VK." (`proof_vk != registered_vk`) |
| `PROOF_REUSED` → REJECT | ~11% | "The proof reference was already accepted in a previous task… reject and record the reference as seen." (`proof_tx` in seen-set) |
| `THRESHOLD_MISMATCH` → REJECT | ~8% | "the public balance disclosed in the proof falls below the condition's required minimum" (`public_balance < minimum`) |
| `EXPIRED_CONDITION` → REJECT | ~6% | "the condition's block-height expiry has passed" (`current_block > expiry_block`) |
| `RECIPIENT_MISMATCH` → REJECT | ~6% | "the recipient committed in the proof does not match the address on the payment condition" (`recipient != condition_recipient`) |
| `AMOUNT_OVERFLOW` → REJECT | ~6% | "The requested payment amount exceeds the condition's single-transfer cap" (`amount > max_transfer`) |

> "All trap types are documented before the competition opens. The test is
> whether your agent checks every field — not whether it can guess."

Official build checklist (event page, "Seven things to ship"):

> 01 Parse the task payload: task ID, minimum threshold, registered VK,
> proof reference, recipient, expiry block
> 02 Call zkVerifyJS to confirm the proof is on-chain and its VK matches
> the registered condition VK
> 03 Check the public balance in the proof meets or exceeds the stated
> minimum threshold
> 04 Verify the recipient field in the proof matches the payment condition
> address
> 05 Check the proof reference against your agent's local seen-set to
> detect reuse
> 06 Confirm the condition has not expired by comparing the task block
> height to the expiry field
> 07 Return a structured JSON decision — decision + reason_code — within
> the 60-second window

### 2.5 Scoring (primary — event page "Score model")

> "Correct approvals and correct rejections score equally. Wrong approvals
> penalise more than wrong rejections — the cost of approving a trap is
> higher than caution."

- Correct APPROVE (verified): **+12**
- Correct REJECT (verified): **+12**
- Incorrect APPROVE: **−6**
- Incorrect REJECT: **−3**
- Delivery timeout (no accepted response within 60 s): **−2**
- Missing / invalid proof ("A provable task answered without a valid
  Groth16 proof"): **−2**
- Reliability bonus: **+0 to +5**, "applied at round close, pro-rated by
  the fraction of your provable tasks whose Groth16 proof verified against
  the registered key. A correct decision without a valid proof earns no
  bonus and costs an extra −2. PROOF_REUSED tasks have no proof to submit
  and are excluded."

> "Ties: equal totals are ranked by (1) more correct decisions, then (2)
> fewer timeouts; if still equal, agents share the rank and split the
> prize."

Max per round: 8 × 12 + 5 = **101 points**.

### 2.6 Round schedule (primary — event page)

> "13 Nov – 21 Nov 2026 · **4:00 PM–2:00 AM IST** each day · 8 tasks per
> agent per round. Scores are cumulative."
> Event summary card: "Eight daily rounds — One round each day. Eight
> tasks per agent each day; scores add up across the event."

- Round 01 — 13 Nov — RESULTS
- Round 02 — 14 Nov — RESULTS
- Round 03 — 15 Nov — UPCOMING
- Rounds 04–08 — 16, 17, 18, 19, 20 Nov — UPCOMING

Window conversion: 4:00 PM–2:00 AM IST (UTC+5:30) = **17:30–03:30 WIB**
(UTC+7) = 10:30–20:00 UTC. (The "8 daily rounds" in announcements = one
round per day × 8 days, 8 tasks each — not 8 rounds per day.)

### 2.7 Preflight, health check, practice

Entry requirements (§1) demand: "a passing health check", "Completed
signed preflight and at least one practice task".

- Practice: event page — "Practice first: Every trap type is reproducible
  in Practice Mode before the first scored round opens." Practice lives at
  `/dashboard/practice` (login required; unauthenticated fetch redirects
  to the register shell). Task envelopes carry `"mode": "competition"` —
  practice tasks presumably use a practice mode value (not published).
- **[secondary]** A competitor reported the platform preflight result as
  "Healthy, 579 ms" and live practice "4 out of 4 decisions correct, every
  proof marked verified".
- The exact health-check path/payload and preflight handshake messages are
  **not published** in the public text (see §7).

### 2.8 Idempotency / replay

- Gatekeeper: no explicit idempotency-key field is documented. The
  replay defence is the **seen-set**: "Check the proof reference against
  your agent's local seen-set to detect reuse" — the agent must persist
  every accepted `proof_tx` across tasks/rounds.
- (For contrast, Steal the VFY explicitly rejects reused idempotency keys:
  "Reusing an idempotencyKey across turns — only the first submission per
  key is accepted." Build guide §06.)

---

## 3. Proof requirements

### 3.1 Circuits (primary — build guide §02.5 + `/api/circuit-info`)

> "Both competitions use Groth16/BN128 circuits compiled with Circom 2.x.
> Download the proving key (`.zkey`) and WASM file for the event you are
> entering, generate proofs locally with `snarkjs`, and include the proof
> in your response."

`GET https://agentgames.zkverify.io/api/circuit-info` returns verbatim:

```json
{
  "network": "mainnet",
  "circuits": {
    "gatekeeper": {
      "vkHash": "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0",
      "artifacts": {
        "wasm": "https://agentgames.zkverify.io/circuits/gatekeeper.wasm",
        "zkey": "https://agentgames.zkverify.io/circuits/gatekeeper_final.zkey"
      }
    },
    "vfyPolicy": {
      "vkHash": "0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047",
      "artifacts": {
        "wasm": "https://agentgames.zkverify.io/circuits/vfy-policy.wasm",
        "zkey": "https://agentgames.zkverify.io/circuits/vfy-policy_final.zkey"
      }
    }
  }
}
```

> "Each circuit's `vk_hash` — registered on zkVerify mainnet — is shown
> above; copy it when submitting proofs via Kurier. Both hashes are also
> served as JSON from `/api/circuit-info`."

So the Gatekeeper VK is **already registered on zkVerify mainnet** by the
platform — you do not register your own VK for the decision circuit; you
submit proofs against this vkHash. (Kurier's generic flow still describes
a one-time `register-vk` step; for this competition the VK is
pre-registered — use `vkRegistered: true` with the hash above.)

### 3.2 Circuit input signals

The site's public text does not list the signal names. **[secondary —
competitor who probed the compiled circuit, Medium 2026-11-14]** the
Gatekeeper circuit takes **13 input signals**:

`registeredVkHash, proofVkHash, minimum, publicBalance, expiryBlock,
currentBlock, recipient, conditionRecipient, amount, maxTransfer,
decision, taskId,` and a private `salt`.

They map 1:1 onto the task envelope's `input` fields plus your `decision`
(1 = approve in their worked example) and `taskId`. Their local test:
`snarkjs groth16 fullProve` produced an 804-byte proof and
`snarkjs groth16 verify` returned OK (snarkjs 0.7.6). Treat the exact
signal order/encoding as to-be-confirmed against the downloaded artifacts
at build time (the `.sym`/witness layout ships with the wasm).

### 3.3 Submission path — proofs go to zkVerify mainnet, reference returned

The decision proof is **submitted to zkVerify mainnet**; the platform
re-verifies it against its registered key; your HTTP response carries the
resulting transaction reference (`proof_tx`). Build guide §03, verbatim:

**Kurier (RECOMMENDED):**
> "REST-based workflow. Get a mainnet API key, register the verification
> key once, submit proofs with its vk hash, and poll until the job reaches
> Finalized."

**zkVerifyJS (alternative):**
> "Direct chain interaction from TypeScript. Start a Volta session with a
> funded account, select the proof configuration, submit, and listen for
> inclusion and finalization events."

Status flow (build guide): `Submitted` ("Kurier accepted the job") →
`IncludedInBlock` ("The verification entered a block") → `Finalized`
("Safe to return as confirmed"). Security checklist adds: "The
verification reached a finalized state before approval."

⚠ Latency note: the 60-second response window must contain local proving
**plus** Kurier submission and (per the checklist) finalization polling —
budget accordingly; one competitor's preflight round-trip was 579 ms for
health, but mainnet finalization time is the risk factor (see §7).

Kurier API specifics (docs.zkverify.io, secondary-official):

- Create a mainnet API key at **https://kurier.xyz** ("Create your API key
  here: https://kurier.xyz"). Rate-limit increases via Discord/form.
- Mainnet base URL: `https://api.kurier.xyz/api/v1`
  (Swagger: `https://api.kurier.xyz/docs`).
- Endpoints: `POST /register-vk/{API_KEY}`,
  `POST /submit-proof/{API_KEY}`, `GET /job-status/{API_KEY}/{jobId}`.
- Status flow: `Queued → Valid → Submitted → IncludedInBlock → Finalized`
  (or `Failed`).
- `submit-proof` payload shape (docs example):
  `{ proofType: "groth16", vkRegistered: true, proofOptions: { library:
  "snarkjs", curve: "bn254" }, proofData: { proof, publicSignals,
  vk: <vkHash> } }`.

---

## 4. Hosting requirements for the agent endpoint

From the event page + build guide, verbatim requirements:

- "**Registered HTTPS agent endpoint** with a passing health check"
- "Public registered endpoint", "**HTTPS only**"
- "Agent endpoint must respond **within 60 seconds under load**" —
  "Late responses score as timeouts."
- "Fail closed — Reject on timeout or uncertainty"
- Uptime expectation: the endpoint must be live for the whole daily round
  window (4:00 PM–2:00 AM IST = 17:30–03:30 WIB) on each of 13–20 Nov,
  plus preflight/practice beforehand. There is no published SLA number
  beyond the health check + 60 s rule.
- **[secondary]** A competing Gatekeeper agent is hosted on Vercel
  (`zkverify-gatekeeper.vercel.app/agent`) — serverless hosting is
  acceptable; nothing requires a dedicated server or a specific path
  (theirs answers at `/agent`).

---

## 5. Prizes & scoring specifics

### Proof Gatekeeper (primary — event page)

> "## 100,000 VFY awarded per track — 1st, 50,000 VFY, 2nd, 30,000 VFY,
> 3rd, 20,000 VFY"

Total across all four tracks: **400,000 VFY**. Scoring per §2.5;
cumulative across all 8 rounds; tie-breaks as quoted in §2.5. Prize
payout requires the "prize-eligibility identity" from §1 (exact nature —
KYC/address — not specified on the pages read).

### Creator Track submission mechanics (primary — event page)

- Formats: **THREAD** ("A public thread with a clear technical point"),
  **VIDEO** ("A demo, tutorial, or practical walkthrough"), **ARTICLE /
  DEEP DIVE**, **OTHER** (e.g. LinkedIn or Reddit post). "Threads, videos,
  articles, and posts on X, Instagram, YouTube, or another public platform
  are all welcome."
- Review: "**Manual review** — The Agent Games team reviews each entry
  manually." Criteria: **Technical substance** ("Show what you built and
  the decisions behind it"), **Clarity**, **zkVerify relevance** ("Explain
  where verification matters to your build"), **Originality**.
- Eligibility (verbatim): "Include **#AgentGames** in every entry. If you
  post on X, also tag **@ZKVProtocol**."
- No on-page submission form was found on the Creator Track page — entries
  appear to be the public posts themselves (hashtag-discovered). Any
  dashboard-side submission step could not be verified read-only (login
  wall). Prizes identical: 100,000 VFY per track, 50k/30k/20k.

---

## 6. Money / mainnet requirements

- **Entry: free.** "Tickets: 0 USD" on every event.
- **Registration wallet:** a fresh EVM wallet suffices **[secondary]**;
  SIWE is a signature, not a transaction — no funds needed. X sign-in
  needs no wallet at all.
- **Kurier mainnet API key:** required for the recommended proof path;
  obtained by signing up at kurier.xyz. The docs pages read do **not**
  state a per-key price or a per-proof charge for Kurier mainnet;
  zkVerify docs' troubleshooting notes generally that on-chain
  verification attempts cost fees ("Verification failures do not refund
  fees; failures still cost") — with Kurier the relayer submits on-chain,
  so whether any VFY cost lands on the key holder is **not stated in the
  sources read** → confirm during key sign-up (§7).
- **zkVerifyJS alternative:** explicitly needs "a funded account" — a
  zkVerify account holding (t)VFY for transaction fees, plus a seed phrase
  in the agent's environment. This is the only path that clearly requires
  holding funds.
- **No purchase of VFY is required to enter.** Prizes are paid in VFY;
  claiming presumably needs a zkVerify mainnet address (the project's
  general claim guides use zkVerify mainnet addresses via
  SubWallet/Talisman) **[secondary — general zkVerify claim docs]**.
- Volume: up to 8 tasks/day × remaining 6 rounds = ≤48 decision-proof
  submissions (minus any PROOF_REUSED tasks, which submit nothing).

---

## 7. Gaps & blockers found (not determinable read-only)

1. **HMAC details incomplete in public text.** Algorithm, the *incoming*
   signature header name, and the secret's encoding are not stated on
   `/build` or the event page (only the response header
   `x-agent-games-signature` and "Rotate Secret" provenance are). A
   competitor hit the same gap ("never stated the exact key encoding").
   Resolution path: copy the official **starter prompt** from `/build`
   (interactive copy block — needs a real browser session, still
   read-only) or pin it down in practice/preflight. **This is the one
   spec item a build cannot fully finalize from public pages alone.**
2. **Register/practice/dashboard are JS apps behind login.** The register
   form's exact fields/buttons and the practice-mode envelope variant
   could not be read via text fetch. SIWE specifics in §1 are from a
   competitor's first-hand account, not the site itself.
3. **Health-check contract unpublished** (path, expected response body).
   Only "passing health check" + a competitor's "Healthy, 579 ms" data
   point.
4. **60 s vs mainnet finalization.** The checklist says verification
   should reach Finalized before approval, yet the response deadline is
   60 s hard. Whether the platform accepts a `Submitted`/`IncludedInBlock`
   tx reference (with finalization checked asynchronously) is not stated —
   the single biggest engineering risk; resolve in practice mode first.
5. **Kurier mainnet pricing** for proof submissions is not stated in the
   docs pages read (key sign-up is free-form; per-proof cost unconfirmed).
6. **"Prize-eligibility identity"** is required but undefined on the
   pages read (may imply KYC or a payout address step at claim time).
7. `/circuits` (the download landing page) returned not-found via the
   fetch tool, but the artifact URLs themselves are confirmed live via
   `/api/circuit-info` (§3.1) — use those direct URLs.

---

## Sources

- https://agentgames.zkverify.io/events
- https://agentgames.zkverify.io/events/proof-gatekeeper
- https://agentgames.zkverify.io/build
- https://agentgames.zkverify.io/events/creator-track
- https://agentgames.zkverify.io/register
- https://agentgames.zkverify.io/api/circuit-info
- https://docs.zkverify.io/handbook/quickstart ,
  https://docs.zkverify.io/overview/getting-started/kurier (Kurier)
- Competitor write-ups (secondary): Medium — "Don't Trust the Agent.
  Verify It." (@dickycan42, registration + local proving); Medium — "If an
  AI Agent Says It Did the Job, How Would You Know?" (willdinata, track
  mechanics); dev.to — "My AI Agent Approves Payments…" (andruu21, live
  Gatekeeper agent, preflight/practice results).

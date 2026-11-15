# Phase 2 — Registration + platform secrets: results

Run 2026-11-15 (WIB). Wallet sign-in **succeeded**; registration completion
is **blocked on one missing input (a contact email)** that this phase was
not given — see Blocker. Nothing else was created: no Kurier account, no
transactions, no submissions, no social accounts.

## 1. Competition wallet (step 1) ✅

- Fresh throwaway EVM wallet created locally (ethers v6, `Wallet.createRandom`).
- **Address: `0x1804fCA5aDFF512b94dFf658a2aDee2790B84f22`**
- Key material saved to `wallet.json` (mode 600), never printed or logged.
- The wallet holds no funds and signed exactly one message (the SIWE
  sign-in below). It must never receive funds.

## 2. SIWE registration — sign-in ✅, completion ⛔ (step 2)

The flow documented in SPEC.md §1 was confirmed against the site's own
frontend bundle and executed end-to-end:

1. `GET /api/auth/providers` → providers are `twitter` (oauth) and
   `wallet` (credentials). The stack is Auth.js v5 (`__Host-authjs.*` cookies).
2. `GET /api/auth/csrf` → `csrfToken`.
3. `GET /api/auth/wallet/siwe/nonce` → `{ "nonce": "<128 hex chars>" }`.
   (The paths probed in early recon — `/api/auth/nonce`,
   `/api/auth/siwe/nonce` — return 400; the real path is under
   `/api/auth/wallet/`.)
4. SIWE message built byte-identically to the site's frontend
   (recovered from its JS bundle): domain `agentgames.zkverify.io`,
   statement **`Sign in to Agent Games with your wallet.`**, URI
   `https://agentgames.zkverify.io`, Version 1, Chain ID 1, issued-at now,
   expiration +5 minutes. Signed locally with the new wallet.
5. `POST /api/auth/callback/wallet` (form: `message`, `signature`,
   `csrfToken`, `json=true`) → **302 to `/` with a
   `__Secure-authjs.session-token` cookie set.**
6. `GET /api/auth/session` → authenticated:

   ```json
   {"user":{"registrationComplete":false,
            "walletAddress":"0x1804fca5adff512b94dff658a2adee2790b84f22",
            "isAdmin":false},
    "expires":"2026-12-15T00:08:47.902Z"}
   ```

- Session cookies persisted to `session.json` (mode 600) and re-verified
  live after a refresh.
- **No separate competition user ID is exposed** in the session payload;
  identity is the wallet address + (once claimed) the handle.
- Transport note: Node `fetch`/`https` POSTs to this host hang from this
  network (GETs are fine); the working flow uses **curl as transport**,
  Node only for signing. Working scripts: `phase2/register.sh`,
  `phase2/sign-message.js` (the earlier `phase2/register.js` is the
  hanging-fetch version — do not use).

### Registration completion — the remaining form

The authenticated `/register` page renders the completion form
(server-side): **Username** (required, `@`, "Can't be changed later"),
**Contact email** (required, "Private. Used only for round, score, and
prize notifications."), optional X handle / country / referral code, and a
terms checkbox. Submission is a Next.js server action:

- Action name `registerAction`, ID
  `40e5bf48973c6dd65ed00905968c9f214cd5d6371e`, POSTed to `/register`
  with a `Next-Action` header; payload =
  `[{handle, displayName, contactEmail, country, bio: "", twitter, referralCode?}]`.
- Handle availability endpoint (works with our session):
  `GET /api/handles/availability?handle=gunngk` →
  `{"available":true,"valid":true}` — **@gunngk is available**
  (handle rules: 3–30 chars, `^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$`).

## ⛔ BLOCKER — contact email required, none supplied

A diagnostic call to `registerAction` with handle `gunngk` and an empty
email returned HTTP 200 with the RSC payload:

```
1:{"ok":false,"error":"A contact email is required so we can reach you about rounds and prizes."}
```

So the server hard-requires a contact email. This phase's instructions
supplied no email address, and inventing one (a fake address would make
round/prize notifications unreachable and could taint the entry) would be
improvising identity data — the same class as the "do not invent an
endpoint URL" rule. **Registration completion therefore stops here,
one field short.**

**To unblock:** provide any contact email the entry should use, then one
call finishes it:

```
POST /register  (Next-Action: 40e5bf48973c6dd65ed00905968c9f214cd5d6371e)
[{"handle":"gunngk","displayName":"gunngk","contactEmail":"<EMAIL>","country":"","bio":"","twitter":""}]
```

(with the cookies in `session.json`; the session is valid until
2026-12-15.) Expected result: `{"ok":true}`, after which
`/api/auth/session` should show `registrationComplete:true` and
`/dashboard` stops redirecting to `/register`.

## 3. Agent creation (step 3) — not reached

`/dashboard` and `/dashboard/agents` return **307 → `/register`** while
`registrationComplete` is false, so the agent-creation flow (agent name
"GunnGK", endpoint URL, track selection) could not be explored or
executed. Whether the endpoint URL is editable after creation is
therefore **undetermined** — it will be the first thing to check once the
blocker clears (the build guide says "Register the full handler path as
your endpoint — for example /agent… The platform posts to the URL exactly
as registered", which suggests the URL is a first-class registration
field; editability unknown).

## 4. HMAC secret / Rotate Secret (step 4) — not reached

Rotate Secret lives on the dashboard, behind the same blocker.
`hmac-secret.txt` was **not** created. The guide confirms the mechanics
(see §5 below): the secret is platform-generated, revealed once as
plaintext, and is to be set as `AGENT_GAMES_HMAC_SECRET`.

## 5. Starter prompt + spec gaps (step 5) ✅

The official **Proof Gatekeeper starter prompt** was extracted verbatim
from the `/build` page's copy block and saved to **`starter-prompt.txt`**
(3,363 chars; decoded from the page's escaped `<pre><code>` block and
cross-checked line-by-line against the rendered page text — 0 mismatches).
Full extracted `/build` guide text saved as `build-guide.txt`.

Gaps from SPEC.md §7 — resolution status:

- **Incoming HMAC header — RESOLVED.** Same header both directions.
  Starter prompt, item 2 (verbatim):

  > "2. HMAC verification of every inbound request: compute the HMAC over
  > the RAW request body and compare it to the x-agent-games-signature
  > header BEFORE parsing JSON. Reject on mismatch."

- **Preflight / health check — RESOLVED (preflight is the gate).** No
  separate health-check path/payload is published anywhere; the documented
  gate is the signed preflight. Guide §02 (verbatim):

  > "After you register and rotate your secret, the platform sends a
  > signed preflight request to verify your endpoint can authenticate and
  > sign responses correctly. Your agent must return
  > { ok: true, protocolVersion: "v1" } with a valid
  > x-agent-games-signature header. Preflight must pass before the
  > platform marks you active."

  > "// Platform sends this to your endpoint before any task
  > { "type": "agent-games.preflight.v1", "agent_id": "agt_...",
  >   "issued_at": "<issued-at>", "nonce": "abc123" }
  > // Your agent must respond with this — signed
  > { "ok": true, "protocolVersion": "v1" }"

  Also verbatim: "Register the full handler path as your endpoint — for
  example /agent, not just the root. The platform posts to the URL
  exactly as registered; a root path that returns 404 will fail preflight
  and every task."

- **Response shape — CLARIFIED, softens SPEC §7.4.** The proof travels in
  the response body; on-chain submission is an optional audit pointer.
  Guide §02 (verbatim):

  > "Respond with the decision, a reason code, and — on every provable
  > task — the Groth16 proof and its public_signals (an omitted or
  > invalid proof costs −2). proof_tx is an optional on-chain audit
  > pointer. Sign every response…"

  (The guide's sample response still shows only
  `{decision, reason_code, proof_tx}` — an internal inconsistency in
  their docs. Build superset: include `proof` + `public_signals`, plus
  `proof_tx` when a Kurier submission exists.)

- **HMAC algorithm + secret encoding — STILL UNRESOLVED.** The string
  "sha256"/"SHA-256" appears nowhere on `/build`, in the starter prompt,
  or in the guide text; the secret is described only as "the one-time
  plaintext" from Rotate Secret, to be copied as-is into
  `AGENT_GAMES_HMAC_SECRET`. Working assumption for the build:
  HMAC-SHA256 over the raw body, key = the plaintext secret as UTF-8 —
  to be confirmed at preflight (which exists precisely to test this).

- **String task_id → circuit taskId — STILL UNRESOLVED.** The guide's
  envelope sample uses `"task_id": "gk_8d31_..."` and neither the guide
  nor the prompt explains the mapping to the circuit's numeric `taskId`
  input. Remains a practice-mode question (PHASE1.md surprise #3 stands).

## 6. Kurier research (step 6) ✅ — read-only, no sign-up

- **Sign-up: email + password.** kurier.xyz's homepage flow is "Sign up
  and generate your free API key"; its auth page (`/login`) is an
  Email/Password form (with password reset). `/signup` and `/register`
  URLs 404 — account creation is through that same email/password flow.
  No wallet-based or GitHub sign-in was visible. Whether the sign-up
  requires clicking an email-verification link could not be confirmed
  without starting a sign-up (not permitted this phase).
- **Free tier: yes for the key.** The homepage states verbatim: "Sign up
  and generate your **free API key**." zkVerify docs repeat: "Create your
  API key here: https://kurier.xyz"; rate-limit increases are via Discord
  or a form.
- **Per-proof cost: not published.** No pricing page exists on kurier.xyz
  and neither the Kurier docs pages nor the zkVerify Kurier docs state a
  per-proof charge for mainnet submissions. (General zkVerify docs note
  on-chain verification attempts cost fees, but with Kurier the relayer
  submits; whether any VFY cost is passed to the key holder is nowhere
  stated.) **Treat per-proof cost as $0-stated/unconfirmed** — verify
  empirically with the first practice submission once a key exists.
- API shape (from SPEC §3.3, unchanged): base
  `https://api.kurier.xyz/api/v1`; `POST /register-vk/{API_KEY}`,
  `POST /submit-proof/{API_KEY}`, `GET /job-status/{API_KEY}/{jobId}`;
  for this competition use `vkRegistered: true` with the pre-registered
  gatekeeper vkHash.

## Files

- `wallet.json` (600) — competition wallet key material (never printed)
- `session.json` (600) — live Auth.js session cookies + session payload
- `starter-prompt.txt` — official Proof Gatekeeper starter prompt, verbatim
- `build-guide.txt` — full extracted text of https://agentgames.zkverify.io/build
- `phase2/register.sh` + `phase2/sign-message.js` — working SIWE sign-in flow
- `phase2/probe-auth.js`, `phase2/probe-nonce.js`, `phase2/register.js`,
  `phase2/registration-result.json` — recon/diagnostics (register.js is
  the superseded hanging-fetch attempt)
- `hmac-secret.txt` — **not created** (blocked, see §4)

---

## Phase 2b — registration finished; agent creation blocked on repo URL

Run 2026-11-15 (WIB), using contact email `g28158551@gmail.com`
(user-supplied for this step).

### 1. Session re-verification ✅

Saved session still authenticated — no SIWE redo needed:
`{"registrationComplete":false,"walletAddress":"0x1804fca5…","isAdmin":false}`,
expiry 2026-12-15. Cookies in `session.json` remain valid (the
register call below rotated the session token; `session.json` was
updated in place, still mode 600).

### 2. Registration completion ✅

- Handle re-checked: `GET /api/handles/availability?handle=gunngk` →
  `{"available":true,"valid":true}`.
- Submitted `registerAction` exactly as documented in §2
  (POST `/register`, `Next-Action: 40e5bf48973c6dd65ed00905968c9f214cd5d6371e`,
  payload `[{"handle":"gunngk","displayName":"gunngk","contactEmail":"g28158551@gmail.com","country":"","bio":"","twitter":""}]`).
- Response: HTTP 200, RSC result **`1:{"ok":true}`** +
  `NEXT_REDIRECT;replace;/dashboard;307`.
- Verified: `GET /api/auth/session` now returns
  **`registrationComplete: true`** and a new field
  **`competitionUserId: "e092b3af-dc06-47ec-9f30-b811c3785234"`**.
  `/dashboard` and `/dashboard/agents` now load (200, no redirect);
  dashboard shows the @gunngk identity.

### 3. Agent creation ⛔ — server requires a real Repository URL

Dashboard facts (from the live page + its JS bundle
`28k5lx-b2kw6_.js` / `1jtso5vrtgt9w.js`):

- "Registered endpoints — Up to 3 agents per participant — but only one
  may compete in each automated event (Proof Gatekeeper, Steal the VFY)."
- Creation is the server action **`addAgentAction`**
  (ID `406c653ffdf23ce1306a90d56bab9777bd095b4999`, POSTed to
  `/dashboard/agents`), payload = the form state object:
  `[{name, events, repoUrl, endpoint}]`, where `events` uses the exact
  ids `"Proof Gatekeeper"` / `"Steal the VFY"`.
- Form requirements: Agent name **required**, Event tracks **required**,
  Repository URL **required** (hint: "A public GitHub repo on your
  personal account (organization-owned repos aren't supported)"),
  **Agent endpoint OPTIONAL** ("Optional — if your agent is already
  running as a service"; the UI prefixes `https://` if missing).
- Submitted
  `[{"name":"GunnGK","events":["Proof Gatekeeper"],"repoUrl":"","endpoint":""}]`
  → HTTP 200 with the exact server error:

  ```
  {"ok":false,"error":"Repository URL is required."}
  ```

- **Endpoint-URL editability verdict: EDITABLE.** Dedicated server
  actions exist on the agent card: `updateAgentEndpoint`
  (`60034c90cfac0d0a2c276e06558fcc69411ada008e`), `updateAgentEvents`
  (`604b59051f0e536777817161d77a22f3988f276191`), `updateAgentRepo`
  (`6093da527217b3740348cbdd30541f20fd5850e0aa`). So no endpoint is
  needed at creation at all, and it can be set/changed afterwards —
  the placeholder-URL question is moot.
- **Blocker:** a real public GitHub repo URL is strictly required and
  none exists in scope — `gh` is installed in this environment but is
  **not logged into any GitHub host**, and no GitHub credentials were
  supplied. Inventing a repo URL (fake, or someone else's repo) would
  misrepresent the entry, so creation stops here, one field short —
  the same class of blocker as the phase-2 email.
  **To unblock:** provide any real public GitHub repo URL belonging to
  the user (e.g. an empty public repo created for the agent — the repo
  can be updated later via `updateAgentRepo`), then one call finishes
  creation:
  `POST /dashboard/agents` (Next-Action `406c653f…`) with
  `[{"name":"GunnGK","events":["Proof Gatekeeper"],"repoUrl":"<REPO_URL>","endpoint":""}]`.

### 4. HMAC secret — not issued yet (follows from §3)

No agent exists, so there is nothing to rotate; `hmac-secret.txt` was
**not** created. Build-phase note: the `addAgentAction` success
response itself carries the secret — the form handler reads
`{ok, name, secret, agentId}` from the result and shows the secret
once — so the secret is captured at creation, and `rotateAgentSecret`
(`401d2a0d4da0b58a3ad2f76340f07faffe712d96f6`) is only for later
rotations. No `agt_...` id has been issued yet.

### 5. Dashboard facts for the build phase

- Practice: the agents page states "Register an agent endpoint before
  entering an event or running a practice task" — practice tasks are
  launched from the dashboard once an agent + endpoint exist.
- Preflight is triggered via the **`preflightAgent`** server action
  (`4004a8c359b186f7c18dcf3670b6660e389580c550`) from the agent card;
  per §5 the endpoint must answer the signed
  `agent-games.preflight.v1` POST with a signed
  `{ok:true, protocolVersion:"v1"}`.
- The agent object the dashboard renders carries: `id, name, status,
  endpointUrl, repositoryUrl, events, hasStrategyCommitment` plus
  health/task stats (issued/responded/timedOut/verified) — health
  history starts as "Not checked yet".
- All dashboard mutations are Next.js server actions POSTed to
  `/dashboard/agents` with a `Next-Action` header and the session
  cookies (curl transport; Node fetch POSTs hang from this network).

---

## Phase 2c — agent creation blocked: GitHub account must be linked first

Run 2026-11-15 (WIB). Script: `phase2c/create_agent.py` (curl transport,
session cookies from `session.json`).

### 1. Session re-verification ✅

`GET /api/auth/session` →
`registrationComplete: true`, wallet
`0x1804fca5adff512b94dff658a2adee2790B84f22`,
`competitionUserId: e092b3af-dc06-47ec-9f30-b811c3785234`, expiry
2026-12-15. No SIWE redo needed. (The create call below rotated the
session token; `session.json` was updated in place, still mode 600.)

### 2. addAgentAction ⛔ — new server requirement: linked GitHub account

Called exactly as documented in Phase 2b §3:
`POST /dashboard/agents`, `Next-Action: 406c653ffdf23ce1306a90d56bab9777bd095b4999`,
payload
`[{"name":"GunnGK","events":["Proof Gatekeeper"],"repoUrl":"https://github.com/gunngk/gunngk-gatekeeper","endpoint":""}]`.

The repo itself is fine (public, exists), but the server returned
HTTP 200 with the exact error:

```
{"ok":false,"error":"Link your GitHub account in Settings before registering an agent repository."}
```

So agent creation additionally requires the competitor account to have
a **GitHub account linked in Settings** — a requirement that only
surfaces at creation time (it was not visible in the creation form or
its JS bundle findings from Phase 2b). Linking is a GitHub OAuth flow
(Settings page), i.e. a live-browser step; it cannot be done with the
saved session cookies alone.

### 3. HMAC secret — not issued

Creation failed before any secret was issued, so `hmac-secret.txt` was
**not** created and no `agt_...` id exists yet. Nothing else was
changed: no endpoint set, no events modified, no submissions.

### 4. To unblock

1. In a live browser signed in as @gunngk (wallet session), open
   Settings on agentgames.zkverify.io and link the GitHub account
   `gunngk` (owner of the repo above) via its OAuth flow.
2. Re-run the exact same `addAgentAction` call (step 2) — expected
   success response `{ok:true, name, secret, agentId}`; save `secret`
   to `hmac-secret.txt` (600) at that moment, since it is shown once.
3. Then verify the agent on `/dashboard/agents` (name, events,
   agentId, preflight/practice availability).

---

## Phase 2d — GitHub link attempted via curl; blocked on GitHub device verification

Run 2026-11-15 (WIB). Goal: link GitHub `gunngk` to the competitor
account, then run `phase2c/create_agent.py`. **Stopped at the GitHub
login step — a device-verification code is required.** No agent was
created; `hmac-secret.txt` was not written.

### 1. Link initiation — discovered ✅ (no server action; a plain route)

Settings (`/dashboard/settings`, loaded with the saved session) shows
`githubLinked: false`, `githubHandle: null`, and the link is a plain
anchor: **`GET /api/auth/github`**. With the session cookies it returns
**307** to the GitHub OAuth authorize URL:

```
https://github.com/login/oauth/authorize?client_id=Ov23liiY69QGpUAuatKi
  &redirect_uri=https://agentgames.zkverify.io/api/auth/github/callback
  &scope=read:user
  &state=<uuid, fresh per initiation>
```

and sets a **`github_oauth_state`** cookie on the agentgames domain
(the callback evidently checks it against `state`). So the flow is:
initiate (capture authorize URL + state cookie from the *same*
response) → GitHub login → GET the authorize URL → approve → GitHub
redirects to `/api/auth/github/callback?code=…&state=…` with the
agentgames cookies attached. The merged cookie set (session token +
state cookie) was staged locally; a fresh initiation is one GET, so
re-doing it after the blocker clears is trivial.

### 2. GitHub login via curl ⛔ — device verification demanded

Standard web flow with curl (script `gh_login.py`, password read
in-process from `github-credentials.json`, never printed):

- `GET https://github.com/login` → 200, normal form (authenticity
  token + timestamp fields).
- `POST https://github.com/session` (login + password + form fields)
  → **302, `Location: https://github.com/sessions/verified-device`**.
  No bad-credentials error — the password was accepted — but GitHub
  requires **device verification**: it emails a verification code to
  the account email (`g28158551@gmail.com`) that must be entered to
  finish sign-in from this (new) device/network.
- The cookie jar confirms the login did **not** complete: only the
  `_octo` analytics cookie is present — no `user_session`/`logged_in`
  cookie was issued.

Per this phase's constraints the attempt stops here: **a code is
needed** — do not guess, do not loop. (One login attempt only.)

### 3. Remaining steps once unblocked

1. A human completes the GitHub device verification (enter the emailed
   code at `github.com/sessions/verified-device`) — or signs in to
   github.com as `gunngk` in the same live browser that holds the
   agentgames session, making the whole link a same-browser flow.
2. Re-run step 1's initiation (fresh `state` + `github_oauth_state`
   cookie), open the authorize URL while GitHub-authenticated, approve
   (`scope=read:user` only), and follow the redirect to the agentgames
   callback with the agentgames cookies attached.
3. Verify Settings flips to `githubLinked: true` /
   `githubHandle: "gunngk"`.
4. Run `phase2c/create_agent.py` — unchanged and ready; it captures
   the one-time secret to `hmac-secret.txt` (600) on success.

### 4. State after this phase

Unchanged from Phase 2c: registration complete (@gunngk,
competitionUserId `e092b3af-dc06-47ec-9f30-b811c3785234`), session
valid to 2026-12-15, no agent, no secret, no endpoint, no submissions,
no funds moved.

---

## Phase 2e — GitHub linked; agent GunnGK created ✅

Run 2026-11-15 (WIB). Goal from Phase 2d §3 completed end-to-end:
GitHub device verification finished with the owner-supplied code,
the OAuth link ran via curl, Settings flipped to linked, and
`phase2c/create_agent.py` created the agent and captured the one-time
secret. No funds, transactions, proof submissions, or deployments.

### 1. GitHub device verification ✅

- Reused the pending cookie jar from Phase 2d's login attempt
  (`_gh_sess` + `_device_id` still alive): `GET /sessions/verified-device`
  returned the live form (hidden `authenticity_token` + text field
  `otp`) — no fresh login (and no new email) was needed.
- Submitted the owner-supplied 6-digit code in the `otp` field →
  response set **`user_session` / `dotcom_user` / `logged_in`**
  cookies and pointed at `https://github.com/` — a real GitHub
  session for `gunngk` is now held in the jar. Code was accepted
  (not expired).

### 2. Link initiation ✅

Fresh initiation with the saved agentgames session:
`GET /api/auth/github` → 307 to a new
`github.com/login/oauth/authorize?...` URL and a fresh
`github_oauth_state` cookie whose value matches the URL's `state`
(verified programmatically). Session + state cookies merged for the
callback leg.

### 3. OAuth approve + callback ✅

- `GET` authorize URL (GitHub jar) → consent form (hidden
  `authenticity_token`, `client_id`, `redirect_uri`, `state`,
  `scope`, `redirect_uri_specified`).
- `POST /login/oauth/authorize` with those fields + `authorize=1`
  → 200 "OAuth application authorized" page carrying the callback
  URL in a meta-refresh (`/api/auth/github/callback?code=…&state=…`;
  `scope=read:user` only, as expected).
- `GET` callback with the merged agentgames cookies → chain
  200 → 307 → 200, landing on
  **`/dashboard/settings?success=github_linked#accounts`**.
  Any rotated `__Secure-authjs.session-token` from the exchange was
  persisted back to `session.json` (still mode 600).

### 4. Link verified ✅

Settings payload now reads (verbatim fields):
**`githubHandle: "gunngk"`, `githubLinked: true`**.

### 5. Agent creation ✅ — secret captured

`phase2c/create_agent.py` (unchanged) ran clean:

- Session check: `registrationComplete: true`, wallet
  `0x1804fca5adff512b94dff658a2adee2790B84f22`,
  `competitionUserId: e092b3af-dc06-47ec-9f30-b811c3785234`,
  expiry 2026-12-15 (session token rotation persisted to
  `session.json`).
- `addAgentAction` result: **`{ok:true, name:"GunnGK", agentId, secret}`**.
- **agentId: `e671c254-d8bb-4955-96f9-e4aad50323d3`** (UUID form —
  this deployment does not use the `agt_...` prefix the guide samples
  show).
- The one-time secret was written straight to **`hmac-secret.txt`
  (mode 600, 64 chars)** and never printed.
- Dashboard verification: `/dashboard/agents` contains the agent —
  name **GunnGK**, id, event **Proof Gatekeeper**, and the repo
  `gunngk/gunngk-gatekeeper` all present on the page; the agent card
  shows status **"pending"** (awaiting endpoint + preflight, as
  expected — no endpoint is registered yet).

### 6. Remaining blockers

None for registration/linking/creation. Next build-phase steps are
unchanged from earlier phases: register a live endpoint via
`updateAgentEndpoint`, pass the signed preflight (`preflightAgent`),
then practice tasks. The HMAC algorithm/encoding assumption
(HMAC-SHA256, plaintext secret as UTF-8) and the string `task_id` →
circuit `taskId` mapping remain open until preflight/practice
(see Phase 2 §5).

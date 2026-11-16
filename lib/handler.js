"use strict";
// Core request handler — transport-agnostic. Both the Vercel function
// (api/agent.js) and the standalone server (server.js) funnel into
// handle({ method, rawBody, signature }) and get back
// { status, body, headers } where body is the exact raw string to send
// (the HMAC is computed over those exact bytes).
//
// Request flow (POST):
//   1. Verify x-agent-games-signature over the RAW body BEFORE parsing.
//      Bad/missing signature -> 401, nothing is processed.
//   2. type "agent-games.preflight.v1" -> { ok: true, protocolVersion: "v1" }
//   3. type "agent-games.proof-gatekeeper.v1" -> classify (lib/decide.js),
//      record proof_tx in the seen-set, generate a Groth16 proof for the
//      decision, submit it via Kurier (best effort, deadline-bounded),
//      respond { decision, reason_code, proof, public_signals, proof_tx? }.
//      PROOF_REUSED is the one exception: per the event page there is no
//      proof to submit for a reused reference, so no proof is attached.
//   4. Every response — including errors — is signed over its raw body.
//
// Tasks are serialized through a mutex: Groth16 proving is CPU-heavy and
// the seen-set check-then-add must be atomic per task.

const { config } = require("./config");
const { signBody, verifyBody } = require("./hmac");
const { classify, validateInput } = require("./decide");
const { generateProof } = require("./prover");
const { submitProof } = require("./kurier");
const { FileSeenStore } = require("./seenstore");

const TYPE_TASK = "agent-games.proof-gatekeeper.v1";
const TYPE_PREFLIGHT = "agent-games.preflight.v1";

function createHandler(options = {}) {
  const seenStore =
    options.seenStore || new FileSeenStore(config.seenStorePath);
  const secret = options.secret !== undefined ? options.secret : config.hmacSecret;

  let chain = Promise.resolve();
  function serialize(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  function respond(status, obj) {
    const body = JSON.stringify(obj);
    return {
      status,
      body,
      headers: {
        "content-type": "application/json",
        [config.hmacHeader]: signBody(body, secret),
      },
    };
  }

  async function processTask(envelope, startedAt) {
    const input = envelope.input;
    try {
      validateInput(input);
    } catch (err) {
      // Structurally unusable envelope: fail closed with a decision-shaped
      // response (no witness can be built, so no proof can be attached).
      return respond(200, {
        decision: "REJECT",
        reason_code: "INVALID_TASK",
        error: String((err && err.message) || err),
      });
    }

    const { decision, reason_code } = classify(input, seenStore);
    // Record every presented proof reference AFTER classification, so a
    // later task presenting the same reference is caught as PROOF_REUSED.
    seenStore.add(String(input.proof_tx));

    if (reason_code === "PROOF_REUSED") {
      // Event page: "there is no proof to submit" for reused references;
      // these tasks are excluded from the proof reliability bonus.
      return respond(200, { decision, reason_code });
    }

    let proof = null;
    let publicSignals = null;
    try {
      const out = await generateProof(
        input,
        decision === "APPROVE",
        envelope.task_id
      );
      proof = out.proof;
      publicSignals = out.publicSignals;
    } catch (err) {
      // The decision itself was made by deterministic checks; only the
      // artifact failed. Return the decision without a proof (scores as
      // a provable task answered without a valid proof, -2) rather than
      // flipping a verified decision. See PHASE3.md.
      console.error("proof generation failed:", err);
      return respond(200, { decision, reason_code });
    }

    // Kurier submission is best-effort within the remaining budget:
    // proof_tx is an optional audit pointer; the decision + proof in
    // this response are what the platform verifies.
    //
    // Mode-aware poll budget (Phase 4d): practice tasks keep the 10 s
    // cap (15 s practice deadline); scored "competition" tasks get the
    // longer competition budget, because Round 3 showed the 10 s cap
    // letting proof_tx fall back to a jobId when Kurier was slow under
    // round-time load — and the platform's scored verification then
    // failed all 8 proofs even though every proof was valid and every
    // submission was accepted. Worst case stays ~33 s, inside the
    // 60 s scored budget.
    const pollBudgetMs =
      envelope.mode === "competition"
        ? config.kurierPollBudgetCompetitionMs
        : config.kurierPollBudgetMs;
    const deadlineMs = Math.min(
      startedAt + config.responseDeadlineMs,
      Date.now() + pollBudgetMs
    );
    const kurier = await submitProof(proof, publicSignals, deadlineMs, pollBudgetMs).catch(
      (err) => ({ proofTx: null, status: "ERROR", error: String(err) })
    );
    // Audit trail for the next round-3-style investigation: one line
    // per task with the pointer the platform actually received.
    // (No secrets: decision/reason/proof_tx/status only.)
    console.log(
      JSON.stringify({
        task: envelope.task_id,
        mode: envelope.mode || null,
        decision,
        reason_code,
        proof_tx: (kurier && kurier.proofTx) || null,
        kurier_status: (kurier && kurier.status) || null,
        kurier_job: (kurier && kurier.jobId) || null,
        ms: Date.now() - startedAt,
      })
    );

    const body = { decision, reason_code, proof, public_signals: publicSignals };
    if (kurier && kurier.proofTx) body.proof_tx = kurier.proofTx;
    return respond(200, body);
  }

  async function handle({ method, rawBody, signature }) {
    const startedAt = Date.now();
    if (method === "GET" || method === "HEAD") {
      // Health check (exact contract unpublished — SPEC.md §7.3). A plain
      // signed 200 with the protocol version is the sane default.
      return respond(200, { ok: true, protocolVersion: "v1" });
    }
    if (method !== "POST") {
      return respond(405, { ok: false, error: "method_not_allowed" });
    }
    const raw = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(rawBody || "", "utf8");
    if (!verifyBody(raw, signature, secret)) {
      return respond(401, { ok: false, error: "bad_signature" });
    }
    let envelope;
    try {
      envelope = JSON.parse(raw.toString("utf8"));
    } catch (_) {
      return respond(400, { ok: false, error: "invalid_json" });
    }
    if (envelope && envelope.type === TYPE_PREFLIGHT) {
      return respond(200, { ok: true, protocolVersion: "v1" });
    }
    if (envelope && envelope.type === TYPE_TASK) {
      return serialize(() => processTask(envelope, startedAt));
    }
    return respond(400, { ok: false, error: "unknown_type" });
  }

  return handle;
}

module.exports = { createHandler, TYPE_TASK, TYPE_PREFLIGHT };

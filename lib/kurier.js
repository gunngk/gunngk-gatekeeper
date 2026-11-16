"use strict";
// Kurier client: submit a Groth16 decision proof to zkVerify mainnet,
// then poll the job ONLY until it first reports a txHash (status
// Submitted / IncludedInBlock — observed ~4 s in) and return that
// txHash immediately as proof_tx. We deliberately do NOT wait for
// Finalized: the submitted job keeps finalizing on Kurier/zkVerify
// regardless, and proof_tx is only an optional audit pointer — while
// waiting for Finalized measured 26–44 s, which blows the platform's
// 15 s practice deadline and eats most of the 60 s scored budget
// (see PHASE4.md "Phase 4b"). Polling is hard-capped by
// KURIER_POLL_BUDGET_MS (default 10000).
//
// Endpoints/payload per SPEC.md §3.3 and the /build guide's Kurier
// snippet:
//   POST {base}/submit-proof/{API_KEY}
//     { proofType: "groth16", vkRegistered: true,
//       proofOptions: { library: "snarkjs", curve: "bn128" },
//       proofData: { proof, publicSignals, vk: <gatekeeper vkHash> } }
//   GET  {base}/job-status/{API_KEY}/{jobId}
//     status flow: Queued -> Valid -> Submitted -> IncludedInBlock ->
//     Finalized (or Failed)
//
// Field names are confirmed live (phase 4b): the submit response
// carries `jobId`; the status response carries `status` plus, once on
// chain, `txHash`. Extraction below stays defensive anyway.
//
// Fallbacks: if no txHash appears within the poll cap but a jobId
// exists, proof_tx falls back to the jobId. If the submission itself
// failed, proof_tx falls back to the DRY_RUN-style placeholder.
//
// DRY_RUN mode (forced when KURIER_API_KEY is unset, or KURIER_DRY_RUN=1):
// no network calls at all; returns a clearly-labelled placeholder
// reference of the form "dry-run:<sha256 of proof+signals>".
//
// Failure policy: submission/polling problems NEVER throw into the
// request path. The caller always gets a result object; the decision +
// locally generated proof go in the response regardless, with proof_tx
// attached on a best-effort basis (it is an optional audit pointer).

const crypto = require("crypto");
const { config } = require("./config");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function dryRunRef(proof, publicSignals) {
  const h = crypto
    .createHash("sha256")
    .update(JSON.stringify({ proof, publicSignals }))
    .digest("hex");
  return "dry-run:" + h;
}

function pickJobId(job) {
  if (!job || typeof job !== "object") return null;
  return job.jobId || job.id || (job.data && (job.data.jobId || job.data.id)) || null;
}

function pickStatus(st) {
  if (!st || typeof st !== "object") return null;
  const s = st.status || (st.data && st.data.status) || null;
  return s ? String(s) : null;
}

function pickTxRef(obj, fallback) {
  if (!obj || typeof obj !== "object") return fallback || null;
  const cand =
    obj.txHash ||
    obj.transactionHash ||
    obj.tx_hash ||
    obj.hash ||
    obj.proofTx ||
    obj.proof_tx ||
    (obj.data &&
      (obj.data.txHash || obj.data.transactionHash || obj.data.hash)) ||
    null;
  return cand || fallback || null;
}

// Submit + early-return poll. deadlineMs: absolute budget from now
// (the caller's response deadline). pollBudgetMs: cap on polling for
// the first txHash (defaults to config.kurierPollBudgetMs; the handler
// passes the longer competition budget for scored rounds — see
// PHASE4.md "Phase 4d"). Polling additionally stops at the first
// observed txHash, or at a terminal status — whichever comes first.
// Returns
//   { proofTx, status, jobId, dryRun, error? }
// status is the last Kurier status seen (typically "Submitted" or
// "IncludedInBlock" on the happy path — the job reaches "Finalized"
// later, unwatched, on Kurier's side).
//
// Submit retry (Phase 4d): a transient submit failure (HTTP 5xx or a
// network error) is retried up to 2 more times with a 1 s backoff,
// as long as the deadline allows — a single failed attempt used to
// fall straight through to the dry-run placeholder, which scored
// rounds treat as an unverified proof. Only a persistent failure
// returns the placeholder.
async function submitProof(proof, publicSignals, deadlineMs, pollBudgetMs) {
  if (config.kurierDryRun) {
    return {
      proofTx: dryRunRef(proof, publicSignals),
      status: "DRY_RUN",
      jobId: null,
      dryRun: true,
    };
  }
  const base = config.kurierBaseUrl.replace(/\/+$/, "");
  const key = config.kurierApiKey;
  const pollBudget =
    typeof pollBudgetMs === "number" && pollBudgetMs > 0
      ? pollBudgetMs
      : config.kurierPollBudgetMs;
  let jobId = null;
  let lastStatus = null;
  let txRef = null;
  let job = null;
  let res = null;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(`${base}/submit-proof/${key}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proofType: "groth16",
          vkRegistered: true,
          proofOptions: { library: "snarkjs", curve: config.kurierCurve },
          proofData: { proof, publicSignals, vk: config.gatekeeperVkHash },
        }),
      });
      job = await res.json().catch(() => null);
      if (res.ok) break;
      lastError = "submit-proof HTTP " + res.status;
    } catch (err) {
      res = null;
      job = null;
      lastError = String((err && err.message) || err);
    }
    // Transient failure: retry while the deadline allows another attempt.
    if (attempt < 2 && Date.now() + 1500 < deadlineMs) {
      await sleep(1000);
      continue;
    }
    break;
  }
  try {
    if (!res || !res.ok) {
      // Submission itself failed -> dry-run-style placeholder, so the
      // response still carries a proof_tx-shaped audit pointer.
      return {
        proofTx: dryRunRef(proof, publicSignals),
        status: "SUBMIT_FAILED",
        jobId: null,
        dryRun: false,
        error: lastError || "submit-proof failed",
      };
    }
    jobId = pickJobId(job);
    txRef = pickTxRef(job, null);
    lastStatus = pickStatus(job);
    if (txRef) {
      // txHash already present in the submit response — done.
      return {
        proofTx: txRef,
        status: lastStatus || "SUBMITTED",
        jobId,
        dryRun: false,
      };
    }
    if (!jobId) {
      return {
        proofTx: dryRunRef(proof, publicSignals),
        status: lastStatus || "SUBMITTED_NO_JOBID",
        jobId: null,
        dryRun: false,
        error: "no jobId in submit response",
      };
    }
    // Early-return polling: stop at the first txHash, a terminal
    // status, the poll-budget cap, or the caller's deadline.
    const stopAt = Math.min(deadlineMs, Date.now() + pollBudget);
    while (Date.now() < stopAt) {
      const wait = Math.min(
        config.kurierPollIntervalMs,
        stopAt - Date.now()
      );
      if (wait > 0) await sleep(wait);
      const sres = await fetch(`${base}/job-status/${key}/${jobId}`);
      const st = await sres.json().catch(() => null);
      if (!sres.ok || !st) continue;
      lastStatus = pickStatus(st) || lastStatus;
      txRef = pickTxRef(st, txRef);
      if (txRef) break; // on chain — return now, job finalizes unwatched
      if (lastStatus === "Finalized" || lastStatus === "Failed") break;
    }
    return {
      proofTx: txRef || jobId,
      status: lastStatus || "SUBMITTED",
      jobId,
      dryRun: false,
    };
  } catch (err) {
    return {
      proofTx: txRef || jobId || dryRunRef(proof, publicSignals),
      status: lastStatus || "ERROR",
      jobId,
      dryRun: false,
      error: String((err && err.message) || err),
    };
  }
}

module.exports = { submitProof };

"use strict";
// Kurier client: submit a Groth16 decision proof to zkVerify mainnet and
// poll the job until Finalized. Endpoints/payload per SPEC.md §3.3 and
// the /build guide's Kurier snippet:
//   POST {base}/submit-proof/{API_KEY}
//     { proofType: "groth16", vkRegistered: true,
//       proofOptions: { library: "snarkjs", curve: "bn128" },
//       proofData: { proof, publicSignals, vk: <gatekeeper vkHash> } }
//   GET  {base}/job-status/{API_KEY}/{jobId}
//     status flow: Queued -> Valid -> Submitted -> IncludedInBlock ->
//     Finalized (or Failed)
//
// *** ASSUMPTIONS (no API key exists yet; unverifiable in this phase) ***
// - The submit response carries the job id as `jobId` (fallbacks: `id`,
//   `data.jobId`). The status response carries `status` plus, once on
//   chain, a tx reference under one of txHash / transactionHash / hash /
//   tx. All are extracted defensively; whatever reference exists is
//   returned. Confirm field names with the first practice submission.
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

// Submit + poll. deadlineMs: absolute budget from now. Returns
//   { proofTx, status, jobId, dryRun, error? }
// status is the last Kurier status seen ("Finalized" on success).
async function submitProof(proof, publicSignals, deadlineMs) {
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
  let jobId = null;
  let lastStatus = null;
  let txRef = null;
  try {
    const res = await fetch(`${base}/submit-proof/${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proofType: "groth16",
        vkRegistered: true,
        proofOptions: { library: "snarkjs", curve: config.kurierCurve },
        proofData: { proof, publicSignals, vk: config.gatekeeperVkHash },
      }),
    });
    const job = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        proofTx: null,
        status: "SUBMIT_FAILED",
        jobId: null,
        dryRun: false,
        error: "submit-proof HTTP " + res.status,
      };
    }
    jobId = pickJobId(job);
    txRef = pickTxRef(job, null);
    lastStatus = pickStatus(job);
    if (!jobId) {
      return {
        proofTx: txRef,
        status: lastStatus || "SUBMITTED_NO_JOBID",
        jobId: null,
        dryRun: false,
        error: "no jobId in submit response",
      };
    }
    // Poll until Finalized / Failed / budget exhausted.
    while (Date.now() < deadlineMs) {
      await sleep(config.kurierPollIntervalMs);
      const sres = await fetch(`${base}/job-status/${key}/${jobId}`);
      const st = await sres.json().catch(() => null);
      if (!sres.ok || !st) continue;
      lastStatus = pickStatus(st) || lastStatus;
      txRef = pickTxRef(st, txRef);
      if (lastStatus === "Finalized" || lastStatus === "Failed") break;
    }
    return {
      proofTx: txRef || jobId,
      status: lastStatus || "UNKNOWN",
      jobId,
      dryRun: false,
    };
  } catch (err) {
    return {
      proofTx: txRef || jobId,
      status: lastStatus || "ERROR",
      jobId,
      dryRun: false,
      error: String((err && err.message) || err),
    };
  }
}

module.exports = { submitProof };

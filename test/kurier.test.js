"use strict";
// Unit tests for lib/kurier.js early-return behaviour (phase 4c).
//
// A mock Kurier HTTP server stands in for api.kurier.xyz. Scenarios:
//   1. txHash appears on the 2nd poll  -> returned immediately
//      (status "Submitted"), polling stops, elapsed << poll budget.
//   2. txHash already in submit response -> no polling at all.
//   3. No txHash within the poll cap   -> proofTx falls back to jobId,
//      elapsed ~= the configured cap (not the 55 s response deadline).
//   4. Terminal "Failed" without txHash -> returns at once, jobId fallback.
//   5. Submit HTTP 500                  -> dry-run-style placeholder.
//
// lib/config.js reads env at load time, so each scenario re-requires
// lib/kurier.js + lib/config.js with fresh env (require cache cleared).
//
// Run: node test/kurier.test.js   (also chained from `npm test`)

const http = require("http");
const path = require("path");

const TX = "0x" + "ab".repeat(32);
const PROOF = { pi_a: ["1", "2", "1"], pi_b: [["1", "2"], ["3", "4"], ["1", "0"]], pi_c: ["1", "2", "1"], protocol: "groth16", curve: "bn128" };
const SIGNALS = ["1", "2", "3"];

// --- programmable mock -------------------------------------------------
let behavior = null; // { submit: {code, body}, polls: [body,...] , pollCount }
function resetBehavior(b) {
  behavior = { pollCount: 0, ...b };
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.method === "POST" && req.url.includes("/submit-proof/")) {
      return send(behavior.submit.code, behavior.submit.body);
    }
    if (req.method === "GET" && req.url.includes("/job-status/")) {
      behavior.pollCount += 1;
      const seq = behavior.polls;
      const body = seq[Math.min(behavior.pollCount - 1, seq.length - 1)];
      return send(200, body);
    }
    return send(404, { error: "not found" });
  });
});

// --- fresh module load with env ---------------------------------------
function loadKurier(env) {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const cfgPath = require.resolve(path.join(__dirname, "..", "lib", "config.js"));
  const kurPath = require.resolve(path.join(__dirname, "..", "lib", "kurier.js"));
  delete require.cache[cfgPath];
  delete require.cache[kurPath];
  return require(kurPath);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${detail || ""}`);
}

async function main() {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const baseEnv = {
    KURIER_API_KEY: "test-key",
    KURIER_DRY_RUN: "",
    KURIER_BASE_URL: `http://127.0.0.1:${port}/api/v1`,
    KURIER_POLL_INTERVAL_MS: "100",
  };
  const deadline = () => Date.now() + 55000;

  try {
    // 1. Early return at first txHash
    {
      resetBehavior({
        submit: { code: 200, body: { jobId: "job-1", status: "Queued" } },
        polls: [{ status: "Valid" }, { status: "Submitted", txHash: TX }],
      });
      const { submitProof } = loadKurier({ ...baseEnv, KURIER_POLL_BUDGET_MS: "10000" });
      const t0 = Date.now();
      const out = await submitProof(PROOF, SIGNALS, deadline());
      const dt = Date.now() - t0;
      const ok =
        out.proofTx === TX &&
        out.status === "Submitted" &&
        out.jobId === "job-1" &&
        behavior.pollCount === 2 &&
        dt < 3000;
      record("early return on first txHash", ok,
        `proofTx=${out.proofTx && out.proofTx.slice(0, 10)}… status=${out.status} polls=${behavior.pollCount} elapsed=${dt}ms`);
    }

    // 2. txHash in submit response -> zero polls
    {
      resetBehavior({
        submit: { code: 200, body: { jobId: "job-2", status: "Submitted", txHash: TX } },
        polls: [{ status: "Finalized", txHash: TX }],
      });
      const { submitProof } = loadKurier({ ...baseEnv, KURIER_POLL_BUDGET_MS: "10000" });
      const t0 = Date.now();
      const out = await submitProof(PROOF, SIGNALS, deadline());
      const dt = Date.now() - t0;
      const ok = out.proofTx === TX && behavior.pollCount === 0 && dt < 1000;
      record("txHash in submit response, no polling", ok,
        `proofTx=${out.proofTx && out.proofTx.slice(0, 10)}… polls=${behavior.pollCount} elapsed=${dt}ms`);
    }

    // 3. No txHash within cap -> jobId fallback at ~cap, not deadline
    {
      resetBehavior({
        submit: { code: 200, body: { jobId: "job-3", status: "Queued" } },
        polls: [{ status: "Queued" }],
      });
      const { submitProof } = loadKurier({ ...baseEnv, KURIER_POLL_BUDGET_MS: "400" });
      const t0 = Date.now();
      const out = await submitProof(PROOF, SIGNALS, deadline());
      const dt = Date.now() - t0;
      const ok = out.proofTx === "job-3" && dt >= 350 && dt < 3000;
      record("poll cap fallback to jobId", ok,
        `proofTx=${out.proofTx} status=${out.status} polls=${behavior.pollCount} elapsed=${dt}ms (cap 400ms)`);
    }

    // 4. Terminal Failed, no txHash -> immediate jobId fallback
    {
      resetBehavior({
        submit: { code: 200, body: { jobId: "job-4", status: "Queued" } },
        polls: [{ status: "Failed" }],
      });
      const { submitProof } = loadKurier({ ...baseEnv, KURIER_POLL_BUDGET_MS: "10000" });
      const t0 = Date.now();
      const out = await submitProof(PROOF, SIGNALS, deadline());
      const dt = Date.now() - t0;
      const ok = out.proofTx === "job-4" && out.status === "Failed" && dt < 3000;
      record("terminal Failed fallback", ok,
        `proofTx=${out.proofTx} status=${out.status} elapsed=${dt}ms`);
    }

    // 5. Submit failure -> dry-run-style placeholder
    {
      resetBehavior({
        submit: { code: 500, body: { error: "boom" } },
        polls: [{ status: "Finalized", txHash: TX }],
      });
      const { submitProof } = loadKurier({ ...baseEnv, KURIER_POLL_BUDGET_MS: "10000" });
      const out = await submitProof(PROOF, SIGNALS, deadline());
      const ok =
        typeof out.proofTx === "string" &&
        out.proofTx.startsWith("dry-run:") &&
        out.status === "SUBMIT_FAILED" &&
        behavior.pollCount === 0;
      record("submit failure placeholder", ok,
        `proofTx=${out.proofTx && out.proofTx.slice(0, 16)}… status=${out.status}`);
    }
  } finally {
    server.close();
  }

  console.log("\n=== KURIER SUMMARY ===");
  const failed = results.filter((r) => !r.pass).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("KURIER TEST ERROR", err);
  process.exit(2);
});

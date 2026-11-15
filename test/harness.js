"use strict";
// Local test harness for the Gatekeeper agent.
//
// - Spawns server.js standalone with a dummy secret, KURIER_DRY_RUN=1 and
//   a fresh seen-store file.
// - Sends a signed preflight, a bad-signature probe, one valid task and
//   one task per trap variety (incl. a two-step PROOF_REUSED sequence).
// - Asserts decision + reason_code for each, verifies the response HMAC,
//   and locally verifies every attached Groth16 proof against the
//   phase-1 verification key (build/verification_key.json).
// - Prints a summary table; exits non-zero on any failure.
//
// Run: node test/harness.js

const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const snarkjs = require("snarkjs");

const ROOT = path.join(__dirname, "..");
const PORT = 3417;
const BASE = `http://127.0.0.1:${PORT}/agent`;
const SECRET = "test-secret-phase3";
const VK = "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";
const OTHER_VK = "0x6c56509f1c56fd1fd4e9737f906d2220f4b95f1d507f1adf6899085bd74be047"; // vfyPolicy hash
const ADDR = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const ADDR2 = "0x000000000000000000000000000000000000dead";

const verificationKey = JSON.parse(
  fs.readFileSync(path.join(ROOT, "build", "verification_key.json"), "utf8")
);

function sign(raw) {
  return crypto.createHmac("sha256", Buffer.from(SECRET, "utf8")).update(raw).digest("hex");
}

async function post(obj, { badSig = false } = {}) {
  const raw = JSON.stringify(obj);
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-games-signature": badSig ? "0".repeat(64) : sign(raw),
    },
    body: raw,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}
  return { status: res.status, text, json, sig: res.headers.get("x-agent-games-signature") };
}

function sigOk(r) {
  return r.sig === sign(r.text);
}

function envelope(taskId, overrides = {}) {
  return {
    type: "agent-games.proof-gatekeeper.v1",
    task_id: taskId,
    mode: "practice",
    issued_at: "2026-11-15T00:00:00Z",
    deadline_at: "2026-11-15T00:01:00Z",
    input: {
      registered_vk: VK,
      proof_vk: VK,
      minimum: "1000",
      public_balance: "1460",
      expiry_block: 8430000,
      current_block: 8420000,
      recipient: ADDR,
      condition_recipient: ADDR,
      amount: "500",
      max_transfer: "1000",
      proof_tx: "0xtx_" + taskId,
      ...overrides,
    },
  };
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${detail || ""}`);
}

async function checkTask(name, env, expectDecision, expectReason, { expectProof = true } = {}) {
  const r = await post(env);
  let detail = `status=${r.status} decision=${r.json && r.json.decision} reason=${r.json && r.json.reason_code}`;
  let ok =
    r.status === 200 &&
    r.json &&
    r.json.decision === expectDecision &&
    r.json.reason_code === expectReason &&
    sigOk(r);
  if (expectProof) {
    if (!r.json.proof || !Array.isArray(r.json.public_signals)) {
      ok = false;
      detail += " | proof MISSING";
    } else {
      const verified = await snarkjs.groth16.verify(
        verificationKey,
        r.json.public_signals,
        r.json.proof
      );
      const decisionSignal = r.json.public_signals[11];
      const wantSignal = expectDecision === "APPROVE" ? "1" : "0";
      detail += ` | proof verified=${verified} decisionSignal=${decisionSignal} proof_tx=${r.json.proof_tx || "-"}`;
      if (!verified || decisionSignal !== wantSignal) ok = false;
    }
  } else {
    detail += ` | proof attached=${Boolean(r.json && r.json.proof)} (expected none)`;
    if (r.json && r.json.proof) ok = false;
  }
  record(name, ok, detail);
  return r;
}

async function waitReady(proc) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error("server exited early: " + proc.exitCode);
    try {
      const res = await fetch(BASE);
      if (res.status === 200) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not become ready");
}

async function main() {
  const seenPath = path.join(os.tmpdir(), `agentgames-seen-test-${process.pid}.json`);
  try {
    fs.unlinkSync(seenPath);
  } catch (_) {}

  const proc = spawn("node", [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      AGENT_GAMES_SECRET: SECRET,
      KURIER_DRY_RUN: "1",
      SEEN_STORE_PATH: seenPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr.on("data", (d) => process.stderr.write("[server] " + d));

  try {
    await waitReady(proc);

    // Health (GET)
    {
      const res = await fetch(BASE);
      const text = await res.text();
      const ok = res.status === 200 && JSON.parse(text).ok === true;
      record("health GET", ok, `status=${res.status} body=${text}`);
    }

    // Preflight
    {
      const r = await post({
        type: "agent-games.preflight.v1",
        agent_id: "agt_test",
        issued_at: "2026-11-15T00:00:00Z",
        nonce: "abc123",
      });
      const ok =
        r.status === 200 &&
        r.json &&
        r.json.ok === true &&
        r.json.protocolVersion === "v1" &&
        sigOk(r);
      record("preflight", ok, `status=${r.status} body=${r.text} sigValid=${sigOk(r)}`);
    }

    // Bad signature -> 401, nothing processed
    {
      const r = await post(envelope("gk_bad_1"), { badSig: true });
      record("bad signature rejected", r.status === 401, `status=${r.status} body=${r.text}`);
    }

    // One valid task + one per trap variety
    await checkTask("VALID_CONDITION", envelope("gk_t_valid"), "APPROVE", "VALID_CONDITION");
    await checkTask(
      "VK_SUBSTITUTION",
      envelope("gk_t_vk", { proof_vk: OTHER_VK }),
      "REJECT",
      "VK_SUBSTITUTION"
    );
    await checkTask(
      "THRESHOLD_MISMATCH",
      envelope("gk_t_thr", { public_balance: "999" }),
      "REJECT",
      "THRESHOLD_MISMATCH"
    );
    await checkTask(
      "AMOUNT_OVERFLOW",
      envelope("gk_t_amt", { amount: "1001" }),
      "REJECT",
      "AMOUNT_OVERFLOW"
    );
    await checkTask(
      "RECIPIENT_MISMATCH",
      envelope("gk_t_rcp", { condition_recipient: ADDR2 }),
      "REJECT",
      "RECIPIENT_MISMATCH"
    );
    await checkTask(
      "EXPIRED_CONDITION",
      envelope("gk_t_exp", { current_block: 8430001 }),
      "REJECT",
      "EXPIRED_CONDITION"
    );

    // PROOF_REUSED: first presentation approves, second (same proof_tx,
    // otherwise valid, different task_id) is rejected with no proof.
    const reusedTx = "0xreused_reference_123";
    await checkTask(
      "REUSE setup (first use)",
      envelope("gk_t_reuse1", { proof_tx: reusedTx }),
      "APPROVE",
      "VALID_CONDITION"
    );
    await checkTask(
      "PROOF_REUSED",
      envelope("gk_t_reuse2", { proof_tx: reusedTx }),
      "REJECT",
      "PROOF_REUSED",
      { expectProof: false }
    );
  } finally {
    proc.kill("SIGTERM");
    try {
      fs.unlinkSync(seenPath);
    } catch (_) {}
  }

  console.log("\n=== SUMMARY ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  const failed = results.filter((r) => !r.pass).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("HARNESS ERROR", err);
  process.exit(2);
});

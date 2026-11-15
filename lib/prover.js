"use strict";
// Groth16 proof generation with snarkjs, using the phase-1 code path
// (snarkjs.groth16.fullProve over the official wasm/zkey — see PHASE1.md).
//
// Circuit inputs (13, all scalars):
//   registeredVkHash, proofVkHash, minimum, publicBalance, expiryBlock,
//   currentBlock, recipient, conditionRecipient, amount, maxTransfer,
//   decision (1=approve, 0=reject), taskId, salt (private)
// Public signals order: [0] output commitment, [1] registeredVkHash,
//   [2] proofVkHash, [3] minimum, [4] publicBalance, [5] expiryBlock,
//   [6] currentBlock, [7] recipient, [8] conditionRecipient, [9] amount,
//   [10] maxTransfer, [11] decision, [12] taskId
//
// *** ASSUMPTION — taskId mapping (verify in practice mode) ***
// The platform's task_id is a string ("gk_24_9d1"); the circuit's taskId
// is a bare BN254 field element. No official mapping is published
// (PHASE1.md surprise #3). Default scheme (TASKID_MODE=sha256):
//   taskId = int(sha256(task_id)) mod p
// Alternatives kept for a one-env flip if practice disagrees:
//   "digits"  -> integer formed by the decimal digits in the string
//   "numeric" -> the string parsed as an integer (0 if not numeric)
// The salt is derived deterministically the same way:
//   salt = int(sha256("agent-games-gatekeeper-salt:" + task_id)) mod p
// so the whole pipeline is a pure function of the envelope (the decision
// must be deterministic; Groth16 proofs themselves are randomized, which
// is expected and fine).

const crypto = require("crypto");
const path = require("path");
const snarkjs = require("snarkjs");
const { config, FIELD_P } = require("./config");

function sha256Field(str) {
  const h = crypto.createHash("sha256").update(String(str), "utf8").digest("hex");
  return BigInt("0x" + h) % FIELD_P;
}

function taskIdToField(taskId) {
  const s = String(taskId);
  if (config.taskIdMode === "digits") {
    const d = s.replace(/[^0-9]/g, "");
    return d ? BigInt(d) % FIELD_P : 0n;
  }
  if (config.taskIdMode === "numeric") {
    try {
      return BigInt(s) % FIELD_P;
    } catch (_) {
      return 0n;
    }
  }
  return sha256Field(s); // "sha256" default
}

function deriveSalt(taskId) {
  return sha256Field("agent-games-gatekeeper-salt:" + String(taskId));
}

// Build the snarkjs input object from a parsed envelope input + decision.
// Values are passed exactly as phase 1 did: hex strings for hashes and
// addresses (snarkjs reduces mod p itself), decimal strings for integers.
function buildCircuitInput(input, decision, taskId) {
  return {
    registeredVkHash: String(input.registered_vk),
    proofVkHash: String(input.proof_vk),
    minimum: String(input.minimum),
    publicBalance: String(input.public_balance),
    expiryBlock: String(input.expiry_block),
    currentBlock: String(input.current_block),
    recipient: String(input.recipient),
    conditionRecipient: String(input.condition_recipient),
    amount: String(input.amount),
    maxTransfer: String(input.max_transfer),
    decision: decision ? 1 : 0,
    taskId: taskIdToField(taskId).toString(10),
    salt: deriveSalt(taskId).toString(10),
  };
}

let artifacts = null;
function artifactPaths() {
  if (!artifacts) {
    artifacts = {
      wasm: path.join(config.circuitsDir, "gatekeeper.wasm"),
      zkey: path.join(config.circuitsDir, "gatekeeper_final.zkey"),
    };
  }
  return artifacts;
}

// Generate a proof. ~0.9 s on the phase-1 VM. Returns { proof, publicSignals }.
async function generateProof(input, decision, taskId) {
  const circuitInput = buildCircuitInput(input, decision, taskId);
  const { wasm, zkey } = artifactPaths();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    wasm,
    zkey
  );
  return { proof, publicSignals, circuitInput };
}

module.exports = { generateProof, buildCircuitInput, taskIdToField, deriveSalt };

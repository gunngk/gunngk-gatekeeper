"use strict";
// Deterministic decision logic for Proof Gatekeeper tasks. No LLM, no
// randomness, no clock dependence: same envelope + same seen-set state
// always yields the same classification.
//
// Classification precedence (each generated task carries exactly one trap
// variety — the published shares sum to 100% — so precedence only matters
// for defence in depth). Order follows the phase-3 brief / event-page
// checklist:
//   1. VK_SUBSTITUTION     proof_vk != registered_vk, or proof_vk != the
//                          official gatekeeper vkHash from /api/circuit-info
//   2. THRESHOLD_MISMATCH  public_balance < minimum
//   3. AMOUNT_OVERFLOW     amount > max_transfer
//   4. RECIPIENT_MISMATCH  recipient != condition_recipient
//   5. EXPIRED_CONDITION   current_block > expiry_block
//   6. PROOF_REUSED        proof_tx already in the seen-set
//   otherwise VALID_CONDITION -> APPROVE
//
// All comparisons are BigInt comparisons, so hex/decimal strings and JSON
// numbers compare correctly, and the 256-bit VK hashes compare exactly
// (field reduction is a proving concern, not a comparison concern).

const { config } = require("./config");

function toBig(v) {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  if (typeof v === "string") {
    const s = v.trim();
    if (/^0x[0-9a-fA-F]+$/.test(s)) return BigInt(s);
    return BigInt(s);
  }
  throw new Error("not an integer-like value: " + String(v));
}

const REQUIRED_FIELDS = [
  "registered_vk",
  "proof_vk",
  "minimum",
  "public_balance",
  "expiry_block",
  "current_block",
  "recipient",
  "condition_recipient",
  "amount",
  "max_transfer",
  "proof_tx",
];

// Throws on a structurally unusable envelope (caller fails closed).
// Every field except proof_tx must be integer-like (hashes and addresses
// included). proof_tx is an opaque reference string — it is not a circuit
// input; it is only tracked in the seen-set — so it is only required to
// be a non-empty string.
function validateInput(input) {
  if (!input || typeof input !== "object") throw new Error("missing input object");
  for (const f of REQUIRED_FIELDS) {
    if (input[f] === undefined || input[f] === null || input[f] === "") {
      throw new Error("missing field: " + f);
    }
    if (f !== "proof_tx") toBig(input[f]);
  }
}

// seenStore: object with has(id). Returns { decision, reason_code } where
// decision is "APPROVE" | "REJECT".
function classify(input, seenStore) {
  const registeredVk = toBig(input.registered_vk);
  const proofVk = toBig(input.proof_vk);
  const officialVk = toBig(config.gatekeeperVkHash);

  if (proofVk !== registeredVk || proofVk !== officialVk) {
    return { decision: "REJECT", reason_code: "VK_SUBSTITUTION" };
  }
  if (toBig(input.public_balance) < toBig(input.minimum)) {
    return { decision: "REJECT", reason_code: "THRESHOLD_MISMATCH" };
  }
  if (toBig(input.amount) > toBig(input.max_transfer)) {
    return { decision: "REJECT", reason_code: "AMOUNT_OVERFLOW" };
  }
  if (toBig(input.recipient) !== toBig(input.condition_recipient)) {
    return { decision: "REJECT", reason_code: "RECIPIENT_MISMATCH" };
  }
  if (toBig(input.current_block) > toBig(input.expiry_block)) {
    return { decision: "REJECT", reason_code: "EXPIRED_CONDITION" };
  }
  if (seenStore && seenStore.has(String(input.proof_tx))) {
    return { decision: "REJECT", reason_code: "PROOF_REUSED" };
  }
  return { decision: "APPROVE", reason_code: "VALID_CONDITION" };
}

module.exports = { classify, validateInput, toBig, REQUIRED_FIELDS };

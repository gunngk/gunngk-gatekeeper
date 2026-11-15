"use strict";
// Central configuration. EVERYTHING protocol-shaped that is still
// unconfirmed lives here (or in hmac.js) so it can be flipped in one place
// after practice mode reveals the platform's exact expectations.

const path = require("path");

// BN254 scalar field prime (snarkjs reduces 256-bit values mod p).
const FIELD_P =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Official Gatekeeper circuit VK hash, from GET /api/circuit-info
// (also printed on the /build page). Pre-registered on zkVerify mainnet.
const GATEKEEPER_VK_HASH =
  "0x6b79c6012a6d8651f3e13bc4d2a20370280ab49700c90c5316d4168bfbad77b0";

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

const ROOT = path.join(__dirname, "..");

const config = {
  // --- HMAC (see lib/hmac.js; scheme still unconfirmed, see PHASE3.md) ---
  // Platform-issued secret from the dashboard "Rotate Secret".
  hmacSecret: env("AGENT_GAMES_SECRET", env("AGENT_GAMES_HMAC_SECRET", "")),
  hmacHeader: env("AGENT_GAMES_HMAC_HEADER", "x-agent-games-signature"),

  // --- Circuits ---
  circuitsDir: env("CIRCUITS_DIR", path.join(ROOT, "circuits")),
  gatekeeperVkHash: env("GATEKEEPER_VK_HASH", GATEKEEPER_VK_HASH),

  // --- Seen-set store ---
  // Local/dev: JSON file. On serverless hosts the filesystem is ephemeral,
  // so point SEEN_STORE_PATH at /tmp there, or swap in a KV-backed store
  // implementing the same interface (see lib/seenstore.js).
  seenStorePath: env("SEEN_STORE_PATH", path.join(ROOT, "data", "seen.json")),

  // --- Kurier ---
  kurierBaseUrl: env("KURIER_BASE_URL", "https://api.kurier.xyz/api/v1"),
  kurierApiKey: env("KURIER_API_KEY", ""),
  // DRY_RUN is forced when no API key is configured.
  kurierDryRun:
    env("KURIER_DRY_RUN", "") === "1" || env("KURIER_API_KEY", "") === "",
  // Build guide uses curve "bn128"; the generic Kurier docs example says
  // "bn254". Same curve, two names — configurable just in case.
  kurierCurve: env("KURIER_CURVE", "bn128"),
  // Poll budget for submit -> first txHash (early return; the job
  // keeps finalizing on Kurier unwatched — see lib/kurier.js and
  // PHASE4.md "Phase 4b"). Hard cap on polling so the whole handler
  // stays within ~15 s even when Kurier is slow to put the job on
  // chain; if no txHash shows up in time, proof_tx falls back to the
  // jobId.
  kurierPollBudgetMs: parseInt(env("KURIER_POLL_BUDGET_MS", "10000"), 10),
  kurierPollIntervalMs: parseInt(env("KURIER_POLL_INTERVAL_MS", "2000"), 10),

  // --- Response budget ---
  // Hard internal deadline for the whole request path (< platform's 60 s).
  responseDeadlineMs: parseInt(env("RESPONSE_DEADLINE_MS", "55000"), 10),

  // --- taskId mapping (ASSUMPTION, see lib/prover.js) ---
  // "sha256" (default) | "digits" | "numeric"
  taskIdMode: env("TASKID_MODE", "sha256"),

  port: parseInt(env("PORT", "3000"), 10),
};

module.exports = { config, FIELD_P, GATEKEEPER_VK_HASH };

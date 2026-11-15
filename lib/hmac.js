"use strict";
// HMAC signing / verification for the Agent Games wire protocol.
//
// *** UNCONFIRMED SCHEME — single place to change ***
// The public docs mandate an HMAC over the RAW body in the
// `x-agent-games-signature` header (both directions) but never state the
// algorithm or the secret/signature encodings (SPEC.md §7.1). Working
// assumption, isolated here and in config:
//   algorithm : HMAC-SHA256
//   key       : the platform secret as raw UTF-8 bytes
//               (AGENT_GAMES_SECRET_FORMAT = raw | hex | base64)
//   signature : hex digest (an optional "sha256=" prefix is stripped;
//               base64 signatures are also accepted on verify)
// Verify in practice mode; if preflight fails on signature, flip the
// knobs below via env before touching any other code.

const crypto = require("crypto");
const { config } = require("./config");

const ALG = process.env.AGENT_GAMES_HMAC_ALG || "sha256";
const SIG_ENCODING = process.env.AGENT_GAMES_HMAC_SIG_ENCODING || "hex";
const SECRET_FORMAT = process.env.AGENT_GAMES_SECRET_FORMAT || "raw";

function keyBytes(secret) {
  if (!secret) return Buffer.alloc(0);
  if (SECRET_FORMAT === "hex") return Buffer.from(secret, "hex");
  if (SECRET_FORMAT === "base64") return Buffer.from(secret, "base64");
  return Buffer.from(secret, "utf8"); // raw plaintext, as pasted from dashboard
}

function computeHmac(rawBody, secret) {
  return crypto
    .createHmac(ALG, keyBytes(secret))
    .update(rawBody) // Buffer or string — must be the exact raw bytes
    .digest();
}

// Sign a raw body (string) -> signature string in the configured encoding.
function signBody(rawBody, secret) {
  const mac = computeHmac(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8"), secret);
  return SIG_ENCODING === "base64" ? mac.toString("base64") : mac.toString("hex");
}

// Constant-time verify of a presented signature against a raw body.
// Tolerant on the presented encoding (hex or base64, optional alg prefix)
// so a single encoding mismatch in practice mode is diagnosable, while
// still requiring the exact MAC bytes to match.
function verifyBody(rawBody, presented, secret) {
  if (!presented || typeof presented !== "string" || !secret) return false;
  let p = presented.trim();
  const eq = p.indexOf("=");
  if (eq > 0 && /^[a-z0-9-]+$/i.test(p.slice(0, eq))) p = p.slice(eq + 1); // "sha256=..." prefix
  const expected = computeHmac(rawBody, secret);
  const candidates = [];
  if (/^[0-9a-fA-F]+$/.test(p) && p.length % 2 === 0) candidates.push(Buffer.from(p, "hex"));
  try {
    candidates.push(Buffer.from(p, "base64"));
  } catch (_) {
    /* not base64 */
  }
  return candidates.some(
    (c) => c.length === expected.length && crypto.timingSafeEqual(c, expected)
  );
}

module.exports = { signBody, verifyBody, ALG, SIG_ENCODING, SECRET_FORMAT };

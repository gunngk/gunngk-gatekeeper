"use strict";
// Vercel serverless entry point. Register the deployed URL of this
// function (e.g. https://<project>.vercel.app/api/agent) as the agent
// endpoint on the Agent Games dashboard.
//
// The raw request body is read from the stream untouched — the HMAC is
// computed over the exact bytes, so no body parser may run first
// (see the exported config below).
//
// Deploy notes:
// - Set env vars: AGENT_GAMES_SECRET, KURIER_API_KEY (see .env.example).
// - vercel.json includes circuits/** in this function's bundle and sets
//   maxDuration 60 (the platform's hard deadline).
// - SEEN_STORE_PATH defaults to <project>/data/seen.json, which is NOT
//   persistent on Vercel; set it to /tmp/seen.json for warm-instance
//   persistence, or swap in a KV-backed store (lib/seenstore.js).

const { createHandler } = require("../lib/handler");
const { config } = require("../lib/config");

const handle = createHandler();

module.exports = async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);
    const result = await handle({
      method: req.method,
      rawBody,
      signature: req.headers[config.hmacHeader],
    });
    res.statusCode = result.status;
    for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
    res.end(result.body);
  } catch (err) {
    console.error("handler error:", err);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "internal_error" }));
  }
};

// Disable Vercel's body parsing so the raw bytes reach the HMAC check.
module.exports.config = { api: { bodyParser: false } };

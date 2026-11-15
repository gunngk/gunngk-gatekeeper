"use strict";
// Standalone HTTP server wrapping the same core handler as the Vercel
// function. Usage:
//   AGENT_GAMES_SECRET=<secret> node server.js
// Listens on PORT (default 3000). Any path is accepted — register the
// full URL you expose (e.g. https://host/agent) on the dashboard; the
// platform posts to the URL exactly as registered.

const http = require("http");
const { createHandler } = require("./lib/handler");
const { config } = require("./lib/config");

const handle = createHandler();

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    try {
      const rawBody = Buffer.concat(chunks);
      const result = await handle({
        method: req.method,
        rawBody,
        signature: req.headers[config.hmacHeader],
      });
      res.writeHead(result.status, result.headers);
      res.end(result.body);
    } catch (err) {
      console.error("handler error:", err);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "internal_error" }));
    }
  });
  req.on("error", () => {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "request_error" }));
  });
});

server.listen(config.port, () => {
  console.log(
    `gatekeeper agent listening on :${config.port} ` +
      `(kurier dry-run: ${config.kurierDryRun}, secret set: ${Boolean(config.hmacSecret)})`
  );
});

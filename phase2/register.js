// Agent Games registration via the site's own wallet SIWE flow (Auth.js):
//   GET  /api/auth/csrf                 -> csrfToken + cookies
//   GET  /api/auth/wallet/siwe/nonce    -> { nonce }
//   build EIP-4361 message exactly as the site's frontend does, sign locally
//   POST /api/auth/callback/wallet      -> form { message, signature, csrfToken, json:true }
//   GET  /api/auth/session              -> verify session
// Persists cookies to ../session.json (600) and a diagnostic summary to
// ./registration-result.json. The private key never leaves wallet.json and
// is never printed.
const fs = require("fs");
const path = require("path");
const { Wallet } = require("ethers");

const BASE = "https://agentgames.zkverify.io";
const ROOT = path.join(__dirname, "..");
const walletData = JSON.parse(fs.readFileSync(path.join(ROOT, "wallet.json"), "utf8"));
const wallet = new Wallet(walletData.privateKey);

const jar = new Map();
function mergeCookies(setCookies) {
  for (const c of setCookies || []) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
async function req(url, opts = {}) {
  const res = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(25000),
    headers: {
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
      ...(jar.size ? { cookie: cookieHeader() } : {}),
      ...(opts.headers || {}),
    },
    ...opts,
  });
  mergeCookies(res.headers.getSetCookie ? res.headers.getSetCookie() : []);
  return res;
}
function saveSession(extra = {}) {
  const out = {
    savedAt: new Date().toISOString(),
    base: BASE,
    address: wallet.address,
    cookies: Object.fromEntries(jar.entries()),
    ...extra,
  };
  const p = path.join(ROOT, "session.json");
  fs.writeFileSync(p, JSON.stringify(out, null, 2), { mode: 0o600 });
  fs.chmodSync(p, 0o600);
}

(async () => {
  const diag = { address: wallet.address, steps: [] };

  // 1. CSRF
  let res = await req(BASE + "/api/auth/csrf");
  const csrfBody = await res.json();
  diag.steps.push({ step: "csrf", status: res.status });
  const csrfToken = csrfBody.csrfToken;
  if (!csrfToken) throw new Error("no csrfToken returned");

  // 2. SIWE nonce
  res = await req(BASE + "/api/auth/wallet/siwe/nonce");
  const nonceText = await res.text();
  diag.steps.push({ step: "nonce", status: res.status, body: nonceText.slice(0, 200) });
  if (!res.ok) throw new Error("nonce endpoint failed: " + res.status);
  const { nonce } = JSON.parse(nonceText);
  if (!nonce) throw new Error("no nonce in response");

  // 3. Build the SIWE message exactly like the site's frontend
  const issuedAt = new Date();
  const expirationTime = new Date(issuedAt.getTime() + 300000);
  const message =
    `${"agentgames.zkverify.io"} wants you to sign in with your Ethereum account:\n` +
    `${wallet.address}\n\n` +
    `Sign in to Agent Games with your wallet.\n\n` +
    `URI: ${BASE}\n` +
    `Version: 1\n` +
    `Chain ID: 1\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt.toISOString()}\n` +
    `Expiration Time: ${expirationTime.toISOString()}`;
  diag.message = message;

  // 4. Sign
  const signature = await wallet.signMessage(message);
  diag.steps.push({ step: "sign", ok: true });

  // 5. POST callback (Auth.js credentials sign-in)
  const form = new URLSearchParams({ message, signature, csrfToken, json: "true" });
  res = await req(BASE + "/api/auth/callback/wallet", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const cbText = await res.text();
  diag.steps.push({ step: "callback", status: res.status, body: cbText.slice(0, 500) });
  saveSession({ phase: "post-callback" });

  // 6. Verify session
  res = await req(BASE + "/api/auth/session");
  const sessText = await res.text();
  diag.steps.push({ step: "session", status: res.status, body: sessText.slice(0, 1000) });
  let session = null;
  try { session = JSON.parse(sessText); } catch {}
  diag.session = session;
  saveSession({ phase: "verified", session });

  fs.writeFileSync(path.join(__dirname, "registration-result.json"), JSON.stringify(diag, null, 2));
  console.log("callback status:", diag.steps.find((s) => s.step === "callback").status);
  console.log("session:", sessText.slice(0, 1000));
  console.log("cookies saved:", [...jar.keys()].join(", "));
})().catch((e) => {
  console.error("REGISTRATION FAILED:", e.message);
  try {
    fs.writeFileSync(
      path.join(__dirname, "registration-result.json"),
      JSON.stringify({ address: wallet.address, error: e.message, at: new Date().toISOString() }, null, 2)
    );
  } catch {}
  process.exit(1);
});

// Probe nonce issuance: try POST /api/auth/nonce with the CSRF cookie jar.
const BASE = "https://agentgames.zkverify.io";

function jarFrom(setCookies) {
  const jar = new Map();
  for (const c of setCookies) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  return jar;
}
function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
function merge(jar, setCookies) {
  for (const c of setCookies) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

(async () => {
  const jar = new Map();
  let res = await fetch(BASE + "/api/auth/csrf", { headers: { "user-agent": "Mozilla/5.0" } });
  merge(jar, res.headers.getSetCookie());
  const { csrfToken } = await res.json();
  console.log("got csrfToken (len", csrfToken.length + ")");

  for (const [label, path, body] of [
    ["POST nonce (form csrf)", "/api/auth/nonce", new URLSearchParams({ csrfToken })],
    ["POST nonce (json csrf)", "/api/auth/nonce", JSON.stringify({ csrfToken })],
    ["POST siwe/nonce (form csrf)", "/api/auth/siwe/nonce", new URLSearchParams({ csrfToken })],
  ]) {
    const isJson = typeof body === "string";
    res = await fetch(BASE + path, {
      method: "POST",
      headers: {
        "user-agent": "Mozilla/5.0",
        cookie: cookieHeader(jar),
        "content-type": isJson ? "application/json" : "application/x-www-form-urlencoded",
      },
      body,
      redirect: "manual",
    });
    const text = await res.text();
    console.log(`\n=== ${label} -> ${res.status}`);
    console.log("body:", text.slice(0, 500));
  }
})().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});

// Read-only recon of the NextAuth endpoints on agentgames.zkverify.io.
// No signing, no POST to callback. Discovers csrf/providers/nonce shapes.
const BASE = "https://agentgames.zkverify.io";

async function probe(path, opts = {}) {
  const res = await fetch(BASE + path, {
    redirect: "manual",
    headers: { "user-agent": "Mozilla/5.0 (agentgames-phase2-recon)" },
    ...opts,
  });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const text = await res.text();
  console.log(`\n=== ${opts.method || "GET"} ${path} -> ${res.status} ${res.statusText}`);
  console.log("content-type:", res.headers.get("content-type"));
  if (res.headers.get("location")) console.log("location:", res.headers.get("location"));
  if (setCookies.length) console.log("set-cookie names:", setCookies.map((c) => c.split("=")[0]).join(", "));
  console.log("body (first 800 chars):", text.slice(0, 800));
  return { res, text, setCookies };
}

(async () => {
  await probe("/api/auth/providers");
  await probe("/api/auth/csrf");
  await probe("/api/auth/session");
  // candidate nonce endpoints
  await probe("/api/auth/nonce");
  await probe("/api/auth/siwe/nonce");
})().catch((e) => {
  console.error("probe failed:", e.message);
  process.exit(1);
});

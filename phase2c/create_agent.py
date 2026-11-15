#!/usr/bin/env python3
"""Phase 2c: create the GunnGK agent via the dashboard's addAgentAction.

Transport is curl (Node fetch POSTs hang on this network). The one-time
secret in the success response is written straight to hmac-secret.txt
(mode 600) and is NEVER printed.
"""
import json
import os
import re
import subprocess
import sys

BASE = "https://agentgames.zkverify.io"
ROOT = os.path.expanduser("~/workspace/agentgames")
SESSION_PATH = os.path.join(ROOT, "session.json")
SECRET_PATH = os.path.join(ROOT, "hmac-secret.txt")
ADD_AGENT_ACTION = "406c653ffdf23ce1306a90d56bab9777bd095b4999"
UA = "Mozilla/5.0"

PAYLOAD = [{
    "name": "GunnGK",
    "events": ["Proof Gatekeeper"],
    "repoUrl": "https://github.com/gunngk/gunngk-gatekeeper",
    "endpoint": "",
}]


def load_session():
    with open(SESSION_PATH) as f:
        return json.load(f)


def cookie_header(sess):
    return "; ".join(f"{k}={v}" for k, v in sess["cookies"].items())


def curl(args, timeout=30):
    r = subprocess.run(["curl", "-s", "--max-time", str(timeout)] + args,
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"curl failed rc={r.returncode}: {r.stderr.strip()}")
    return r.stdout


def main():
    sess = load_session()
    cookies = cookie_header(sess)

    # ---- Step 1: verify session -------------------------------------------
    body = curl(["-H", f"user-agent: {UA}", "-H", f"Cookie: {cookies}",
                 f"{BASE}/api/auth/session"])
    try:
        session = json.loads(body)
    except json.JSONDecodeError:
        print(json.dumps({"step": "session", "ok": False,
                          "error": f"non-JSON session response: {body[:200]}"}))
        sys.exit(1)
    user = session.get("user") or {}
    print(json.dumps({
        "step": "session", "ok": True,
        "registrationComplete": user.get("registrationComplete"),
        "walletAddress": user.get("walletAddress"),
        "competitionUserId": user.get("competitionUserId"),
        "expires": session.get("expires"),
    }))
    if user.get("registrationComplete") is not True:
        print(json.dumps({"step": "create", "ok": False,
                          "error": "registrationComplete is not true; aborting"}))
        sys.exit(1)

    # ---- Step 2: addAgentAction -------------------------------------------
    payload_str = json.dumps(PAYLOAD, separators=(",", ":"))
    hdr_file = "/tmp/ag-2c-headers.txt"
    resp = curl([
        "-X", "POST",
        "-H", f"user-agent: {UA}",
        "-H", f"Cookie: {cookies}",
        "-H", f"Next-Action: {ADD_AGENT_ACTION}",
        "-H", "Content-Type: text/plain;charset=UTF-8",
        "-H", "Accept: text/x-component",
        "-D", hdr_file,
        "--data-binary", payload_str,
        f"{BASE}/dashboard/agents",
    ], timeout=45)

    # Session-token rotation: persist any fresh session cookie.
    try:
        with open(hdr_file) as f:
            headers = f.read()
        m = re.search(r"__Secure-authjs\.session-token=([^;\s]+)", headers)
        if m and m.group(1) != sess["cookies"].get("__Secure-authjs.session-token"):
            sess["cookies"]["__Secure-authjs.session-token"] = m.group(1)
            fd = os.open(SESSION_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                json.dump(sess, f, indent=2)
            print(json.dumps({"step": "session-rotation", "updated": True}))
    except FileNotFoundError:
        pass

    # RSC responses are lines like: 1:{"ok":true,...} — find the result object.
    result = None
    for line in resp.splitlines():
        line = line.strip()
        m = re.match(r"^\d+:(.*)$", line)
        candidate = m.group(1) if m else line
        try:
            obj = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and "ok" in obj:
            result = obj
            break
    if result is None:
        print(json.dumps({"step": "create", "ok": False,
                          "error": "no result object in response",
                          "response_head": resp[:400]}))
        sys.exit(1)

    if not result.get("ok"):
        print(json.dumps({"step": "create", "ok": False,
                          "error": result.get("error")}))
        sys.exit(1)

    secret = result.get("secret")
    agent_id = result.get("agentId")
    if not secret or not agent_id:
        print(json.dumps({"step": "create", "ok": False,
                          "error": "success response missing secret/agentId",
                          "keys": sorted(result.keys())}))
        sys.exit(1)

    # ---- Step 3: save the secret (never printed) ---------------------------
    fd = os.open(SECRET_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(secret)
    os.chmod(SECRET_PATH, 0o600)

    print(json.dumps({
        "step": "create", "ok": True,
        "name": result.get("name"),
        "agentId": agent_id,
        "secret_saved": True,
        "secret_length": len(secret),
    }))

    # ---- Step 4: verify the agent exists on the dashboard ------------------
    page = curl(["-H", f"user-agent: {UA}", "-H", f"Cookie: {cookies}",
                 f"{BASE}/dashboard/agents"], timeout=45)
    with open("/tmp/ag-agents-page.html", "w") as f:
        f.write(page)
    found = {
        "name_on_page": "GunnGK" in page,
        "agent_id_on_page": agent_id in page,
        "event_on_page": "Proof Gatekeeper" in page,
        "repo_on_page": "gunngk-gatekeeper" in page,
    }
    # Pull small context windows around the agent name for status fields.
    snippets = []
    for m in re.finditer(r"GunnGK", page):
        s = max(0, m.start() - 200)
        e = min(len(page), m.end() + 600)
        snippets.append(page[s:e])
        if len(snippets) >= 2:
            break
    print(json.dumps({"step": "verify", **found}))
    with open("/tmp/ag-agents-snippets.txt", "w") as f:
        f.write("\n=====\n".join(snippets))


if __name__ == "__main__":
    main()

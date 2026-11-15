#!/usr/bin/env bash
# Agent Games wallet SIWE registration, curl transport (Node fetch POSTs hang
# from this network; curl is reliable). Node is used only for signing.
set -u
cd "$(dirname "$0")"
BASE="https://agentgames.zkverify.io"
JAR=/tmp/ag-cookies.txt
rm -f "$JAR"

echo "== 1. csrf =="
CSRF_JSON=$(curl -s --max-time 25 -c "$JAR" -H "user-agent: Mozilla/5.0" "$BASE/api/auth/csrf")
echo "$CSRF_JSON"
CSRF=$(echo "$CSRF_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin)['csrfToken'])")

echo "== 2. nonce =="
NONCE_JSON=$(curl -s --max-time 25 -b "$JAR" -c "$JAR" -H "user-agent: Mozilla/5.0" "$BASE/api/auth/wallet/siwe/nonce")
echo "$NONCE_JSON"
NONCE=$(echo "$NONCE_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin)['nonce'])")

echo "== 3. sign =="
SIG=$(node sign-message.js "$NONCE")
echo "signature: ${SIG:0:10}... (len ${#SIG})"

echo "== 4. callback POST =="
curl -s --max-time 30 -b "$JAR" -c "$JAR" -H "user-agent: Mozilla/5.0" \
  -D /tmp/ag-callback-headers.txt \
  --data-urlencode "message@siwe-message.txt" \
  --data-urlencode "signature=$SIG" \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "json=true" \
  "$BASE/api/auth/callback/wallet" > /tmp/ag-callback-body.txt
echo "--- headers ---"; cat /tmp/ag-callback-headers.txt
echo "--- body ---"; cat /tmp/ag-callback-body.txt; echo

echo "== 5. session =="
curl -s --max-time 25 -b "$JAR" -c "$JAR" -H "user-agent: Mozilla/5.0" "$BASE/api/auth/session" > /tmp/ag-session.json
cat /tmp/ag-session.json; echo

echo "== cookie jar =="
cat "$JAR"

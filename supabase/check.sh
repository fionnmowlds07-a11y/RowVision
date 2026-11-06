#!/usr/bin/env bash
# Check the local stack: the API answers on its own port, and a sign-in email carries a 6-digit code.
set -euo pipefail

api=http://127.0.0.1:54421
mail=http://127.0.0.1:54424
key=$(cd "$(dirname "$0")/.." && apps/web/node_modules/.bin/supabase status -o json 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["ANON_KEY"])')
address="check-$(date +%s)@example.com"

curl -fsS "$api/auth/v1/health" -H "apikey: $key" >/dev/null
curl -fsS "$api/auth/v1/otp" -H "apikey: $key" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$address\"}" >/dev/null
sleep 1
message=$(curl -fsS "$mail/api/v1/search?query=to:$address" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["messages"][0]["ID"])')
body=$(curl -fsS "$mail/api/v1/message/$message" \
  | python3 -c 'import json,sys; m=json.load(sys.stdin); print(m["Subject"]); print(m["Text"] or m["HTML"])')

grep -q 'Your RowVision code' <<<"$body"
grep -qE '\b[0-9]{6}\b' <<<"$body"
echo "Supabase is healthy and sign-in codes are arriving."

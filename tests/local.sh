#!/usr/bin/env bash
# ทดสอบเซิร์ฟเวอร์ที่รันอยู่แล้ว (ต้องเปิด server.py ด้วย IMAGE_PROVIDER=mock ก่อน)
#   ADMIN_TOKEN=test-token-123 PORT=8080 bash tests/local.sh
set -u
B=http://localhost:${PORT:-8080}
T=${ADMIN_TOKEN:-}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0
pass(){ echo "PASS  $1"; }
fail(){ echo "FAIL  $1"; FAILED=1; }
jq_(){ python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }

echo "== §8.2  /healthz"
c=$(curl -s -o /dev/null -w '%{http_code}' $B/healthz); [ "$c" = 200 ] && pass "healthz 200" || fail "healthz $c"
curl -s $B/healthz | sed 's/^/  /'

echo "== §8.3  create a campaign through the admin API"
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/campaigns -H 'Content-Type: application/json' -d '{"title":"AI Workshop รุ่น 12"}')
[ "$c" = 401 ] && pass "no admin token -> 401" || fail "no admin token -> $c"
r=$(curl -s -w '\n%{http_code}' -X POST $B/api/campaigns -H 'Content-Type: application/json' -H "X-Admin-Token: $T" \
    -d '{"title":"AI Workshop รุ่น 12","slug":"workshop-12","description":"ปิดคลาส"}')
c=$(echo "$r" | tail -1); [ "$c" = 201 ] && pass "campaign created 201" || fail "campaign -> $c :: $r"
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/campaigns -H 'Content-Type: application/json' -H "X-Admin-Token: $T" -d '{"title":"dup","slug":"workshop-12"}')
[ "$c" = 409 ] && pass "duplicate slug -> 409" || fail "duplicate slug -> $c"

echo "== §8.4  submission WITHOUT a photo must fail"
r=$(curl -s -w '\n%{http_code}' -X POST $B/api/submissions -H 'Content-Type: application/json' \
  -d '{"campaign_slug":"workshop-12","student_name":"ทอม","learnings":["เข้าใจ agent workflow"],"commitments":["ทำ dashboard ทีม"],"theme_id":"street-flash"}')
c=$(echo "$r" | tail -1); [ "$c" = 400 ] && pass "no photo -> 400  $(echo "$r" | head -1)" || fail "no photo -> $c"
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/submissions -H 'Content-Type: application/json' \
  -d '{"campaign_slug":"workshop-12","learnings":["a"],"commitments":["b"],"theme_id":"street-flash","photoData":"data:image/png;base64,aGVsbG8="}')
[ "$c" = 400 ] && pass "photo under 1KB -> 400" || fail "tiny photo -> $c"
FAKE=$(python3 -c 'import base64;print(base64.b64encode(b"NOTANIMAGE"*300).decode())')
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/submissions -H 'Content-Type: application/json' \
  -d "{\"campaign_slug\":\"workshop-12\",\"learnings\":[\"a\"],\"commitments\":[\"b\"],\"theme_id\":\"street-flash\",\"photoData\":\"data:image/png;base64,$FAKE\"}")
[ "$c" = 400 ] && pass "non-image bytes claiming to be png -> 400" || fail "fake png -> $c"
c=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/submissions -H 'Content-Type: application/json' \
  -d '{"campaign_slug":"workshop-12","learnings":["a"],"commitments":["b"],"theme_id":"does-not-exist","photoData":"x"}')
[ "$c" = 400 ] && pass "unknown theme -> 400" || fail "unknown theme -> $c"

echo "== §8.5  submission WITH a photo -> 201 + id"
TMP="$TMP" ROOT="$ROOT" python3 - <<'PY'
import base64, json, os, sys
sys.path.insert(0, os.environ["ROOT"])
import mockimage
png = mockimage.make_poster(width=600, height=800, campaign_title="src photo", theme_id="src")
body = {"campaign_slug": "workshop-12", "student_name": "ทอม",
        "learnings": ["เข้าใจ agent workflow", "เขียน prompt เป็น"],
        "commitments": ["ทำ dashboard ทีม"], "theme_id": "street-flash",
        "photoData": "data:image/png;base64," + base64.b64encode(png).decode()}
open(os.path.join(os.environ["TMP"], "body.json"), "w").write(json.dumps(body, ensure_ascii=False))
PY
r=$(curl -s -w '\n%{http_code}' -X POST $B/api/submissions -H 'Content-Type: application/json' --data-binary @"$TMP/body.json")
c=$(echo "$r" | tail -1); body=$(echo "$r" | head -1)
[ "$c" = 201 ] && pass "submission -> 201  $body" || fail "submission -> $c :: $body"
ID=$(echo "$body" | jq_ 'd["id"]')

echo "== §8.6  poll until status=done"
st=""; s=""
for i in $(seq 1 30); do
  s=$(curl -s $B/api/submissions/$ID); st=$(echo "$s" | jq_ 'd["status"]')
  [ "$st" = "done" ] && break
  sleep 1
done
IMG=$(echo "$s" | jq_ 'd["imageUrl"] or ""')
{ [ "$st" = "done" ] && [ -n "$IMG" ]; } && pass "status=done  imageUrl=$IMG" || fail "status=$st imageUrl=$IMG"

echo "== §8.7  that image URL returns a real image"
h=$(curl -s -o "$TMP/out.png" -w '%{http_code} %{content_type} %{size_download}' "$B$IMG")
case "$h" in 200\ image/png*) pass "GET $IMG -> $h" ;; *) fail "GET $IMG -> $h" ;; esac
file "$TMP/out.png" | grep -q "PNG image data" && pass "$(file -b "$TMP/out.png")" || fail "not a real png"

echo "== gallery + wall data source"
n=$(curl -s "$B/api/submissions?campaign=workshop-12" | jq_ 'len(d["submissions"])')
[ "${n:-0}" -ge 1 ] && pass "GET /api/submissions?campaign= lists $n" || fail "gallery empty"

echo "== all 4 pages reachable"
for p in "/" "/admin" "/c/workshop-12" "/wall.html?c=workshop-12" "/app.css" "/api/themes"; do
  c=$(curl -s -o /dev/null -w '%{http_code}' "$B$p"); [ "$c" = 200 ] && pass "GET $p -> 200" || fail "GET $p -> $c"
done
t=$(curl -s $B/api/themes | jq_ 'len(d["themes"])'); [ "${t:-0}" -ge 6 ] && pass "$t themes served" || fail "only $t themes"

echo "== concurrency: 12 submissions at once, none may be lost"
before=$(curl -s $B/healthz | jq_ 'd["submissions"]')
for i in $(seq 1 12); do curl -s -o /dev/null -X POST $B/api/submissions -H 'Content-Type: application/json' --data-binary @"$TMP/body.json" & done
wait; sleep 6
after=$(curl -s $B/healthz | jq_ 'd["submissions"]')
[ $((after - before)) = 12 ] && pass "12 concurrent writes kept ($before -> $after)" || fail "lost writes ($before -> $after)"

echo "$ID" > "${PW_ID_FILE:-/dev/null}"
[ $FAILED = 0 ] && echo "ALL LOCAL TESTS PASSED" || echo "SOME LOCAL TESTS FAILED"
exit $FAILED

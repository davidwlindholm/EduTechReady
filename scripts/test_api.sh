#!/usr/bin/env bash
# Tests for the PHP API against the running dev
# server (`npm run serve`, http://127.0.0.1:8080). Prints PASS or FAIL per case
# and exits non-zero if any case fails.
#
# Usage: scripts/test_api.sh            (API_BASE overrides the base URL)
# Needs: bash, curl, node, sqlite3.
#
# How the config is varied without a test hook in lib.php:
#   lib.php always loads private/config.php and has no test switch, so nothing
#   here can be triggered on the production server (this script is not
#   deployed). The script moves the developer's private/config.php aside to
#   private/config.php.test-api-backup and writes a temporary config.php that
#   points at a fresh SQLite file in a new temp directory and merges
#   overrides from a JSON file in that directory (cap, api_enabled). The
#   overrides live in JSON, not PHP, so OPcache (on for php -S, revalidated
#   every 2 s) never serves a stale value. A trap restores the original
#   config on any exit. If a run was killed with SIGKILL, the next run finds
#   the marker below in config.php and restores the backup before starting.
#   Retention back-dating writes created_at directly with the sqlite3 CLI.
#   While the script runs, every API request to the dev server uses the
#   temporary test database, never db/dev.sqlite.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${API_BASE:-http://127.0.0.1:8080/api}"
CONFIG="$ROOT/private/config.php"
BACKUP="$ROOT/private/config.php.test-api-backup"
MARKER="TEST_API_SH_TEMPORARY_CONFIG"

for tool in curl node sqlite3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "test_api.sh: $tool is required but not installed" >&2
    exit 2
  fi
done

if ! curl -s -o /dev/null --max-time 5 "$BASE/results.php"; then
  echo "test_api.sh: no server at $BASE. Start it with: npm run serve" >&2
  exit 2
fi

# --- config swap ---------------------------------------------------------

if [ -f "$CONFIG" ] && grep -q "$MARKER" "$CONFIG"; then
  if [ -f "$BACKUP" ]; then
    echo "test_api.sh: restoring private/config.php left over from an interrupted run"
    mv -f "$BACKUP" "$CONFIG"
  else
    rm -f "$CONFIG"
  fi
elif [ -f "$BACKUP" ]; then
  echo "test_api.sh: $BACKUP exists but config.php is not a test config; resolve by hand" >&2
  exit 2
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/edutechready-api.XXXXXX")"
DB="$TMP/test.sqlite"
OVERRIDES="$TMP/overrides.json"
HAD_CONFIG=0
[ -f "$CONFIG" ] && HAD_CONFIG=1

restore() {
  if [ "$HAD_CONFIG" = 1 ] && [ -f "$BACKUP" ]; then
    mv -f "$BACKUP" "$CONFIG"
  elif [ "$HAD_CONFIG" = 0 ]; then
    rm -f "$CONFIG"
  fi
  rm -rf "$TMP"
}
trap restore EXIT
trap 'exit 130' INT TERM

[ "$HAD_CONFIG" = 1 ] && mv -f "$CONFIG" "$BACKUP"
# The temporary config starts with a UTF-8 BOM on purpose: every case below
# checks the status and the three JSON headers, so this proves that output
# from config.php cannot break them (lounge_config() discards it).
printf '\xef\xbb\xbf' > "$CONFIG"
cat >> "$CONFIG" <<PHP
<?php
// $MARKER: written by scripts/test_api.sh and removed when it exits.
// If you see this file outside a test run, restore config.php.test-api-backup.
\$config = [
    'dsn' => 'sqlite:$DB',
    'user' => null,
    'password' => null,
    'api_enabled' => true,
    'retention_days' => 30,
    'max_submissions_per_session' => 200,
    'max_body_bytes' => 16384,
];
\$overrides = json_decode((string) @file_get_contents('$OVERRIDES'), true);
return is_array(\$overrides) ? array_replace(\$config, \$overrides) : \$config;
PHP

set_overrides() { printf '%s\n' "$1" > "$OVERRIDES"; }

# --- request and assertion helpers ---------------------------------------

PASSED=0
FAILED=0
STATUS=""
HEADERS="$TMP/headers"
BODY="$TMP/body"

pass() { PASSED=$((PASSED + 1)); printf 'PASS  %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf 'FAIL  %s: %s\n' "$1" "$2"; }

# request METHOD PATH [BODYFILE] [extra curl args...]
request() {
  local method="$1" path="$2" file="${3:-}"
  shift 3 2>/dev/null || shift $#
  local args=(-s -X "$method" -D "$HEADERS" -o "$BODY" -w '%{http_code}')
  if [ -n "$file" ]; then
    args+=(-H 'Content-Type: application/json' --data-binary "@$file")
  fi
  STATUS="$(curl "${args[@]}" "$@" "$BASE/$path")"
}

header_value() {
  # Case-insensitive header lookup; prints the value without the trailing CR.
  grep -i "^$1:" "$HEADERS" | head -n 1 | sed -e 's/^[^:]*:[[:space:]]*//' -e 's/\r$//'
}

# Checks the three headers every response sets (Content-Type, Cache-Control,
# X-Content-Type-Options). Prints a problem or nothing.
header_problem() {
  local v
  v="$(header_value 'Content-Type')"
  [ "$v" = 'application/json; charset=utf-8' ] || { echo "Content-Type '$v'"; return; }
  v="$(header_value 'Cache-Control')"
  [ "$v" = 'no-store' ] || { echo "Cache-Control '$v'"; return; }
  v="$(header_value 'X-Content-Type-Options')"
  [ "$v" = 'nosniff' ] || { echo "X-Content-Type-Options '$v'"; return; }
}

# expect NAME STATUS ERROR   (ERROR "-" means the body must be {"ok": true...})
expect() {
  local name="$1" want_status="$2" want_error="$3" problem body_check
  if [ "$STATUS" != "$want_status" ]; then
    fail "$name" "status $STATUS, expected $want_status; body $(head -c 200 "$BODY")"
    return
  fi
  problem="$(header_problem)"
  if [ -n "$problem" ]; then
    fail "$name" "header $problem"
    return
  fi
  body_check="$(node -e '
    const [file, want] = process.argv.slice(1);
    let b;
    try { b = JSON.parse(require("fs").readFileSync(file, "utf8")); } catch { console.log("body is not JSON"); process.exit(); }
    if (want === "-") { if (b.ok !== true || "error" in b) console.log("expected ok true, got " + JSON.stringify(b)); }
    else if (b.ok !== false || b.error !== want || Object.keys(b).length !== 2) console.log("expected error " + want + ", got " + JSON.stringify(b));
  ' "$BODY" "$want_error")"
  if [ -n "$body_check" ]; then
    fail "$name" "$body_check"
    return
  fi
  pass "$name"
}

# make_body FILE SESSION CLIENT [JS] [RAW]: writes a complete, valid submission
# for every character in characters.json, then runs JS on it (as `b`, with
# `ids` the character ids) and finally replaces the string "__RAW__" with RAW
# verbatim (for JSON that JSON.stringify cannot produce, such as 42.0).
make_body() {
  node -e '
    const fs = require("fs");
    const [file, session, clientId, js, raw, charsPath] = process.argv.slice(1);
    const ids = JSON.parse(fs.readFileSync(charsPath, "utf8")).characters.map((c) => c.id);
    const b = { session, clientId, placements: {} };
    ids.forEach((id, i) => { b.placements[id] = { samr: (i * 13) % 101, rogers: (i * 29) % 101 }; });
    if (js) new Function("b", "ids", js)(b, ids);
    let text = JSON.stringify(b);
    if (raw) text = text.replace("\"__RAW__\"", raw);
    fs.writeFileSync(file, text);
  ' "$1" "$2" "$3" "${4:-}" "${5:-}" "$ROOT/public/content/characters.json"
}

uuid() {
  node -e 'console.log(require("crypto").randomUUID())'
}

submit_case() {
  # submit_case NAME STATUS ERROR SESSION CLIENT [JS] [RAW]
  local name="$1" status="$2" error="$3"
  make_body "$TMP/req.json" "$4" "$5" "${6:-}" "${7:-}"
  request POST submit.php "$TMP/req.json"
  expect "$name" "$status" "$error"
}

db_count() {
  sqlite3 "$DB" "$1"
}

# --- activate the test config --------------------------------------------
# OPcache may serve the old config.php for up to 2 s. With api_enabled false
# a 503 from results.php proves the temporary config is live.

set_overrides '{"api_enabled": false}'
active=0
for _ in $(seq 1 40); do
  request GET 'results.php?session=K7MP3Q'
  if [ "$STATUS" = 503 ]; then active=1; break; fi
  sleep 0.25
done
if [ "$active" != 1 ]; then
  echo "test_api.sh: the temporary config did not take effect (status $STATUS)" >&2
  exit 1
fi

echo "Testing $BASE with a fresh SQLite database in $TMP"

# --- api_enabled false ---------------------------------------------------

expect 'closed: GET results.php -> 503 closed' 503 closed
submit_case 'closed: POST submit.php -> 503 closed' 503 closed K7MP3Q "$(uuid)"
if [ -e "$DB" ]; then
  fail 'closed: no database access' "database file was created while closed"
else
  pass 'closed: no database access'
fi
set_overrides '{}'

# --- valid submit and duplicate ------------------------------------------

S1=K7MP3Q
C1="$(uuid)"
submit_case 'valid submit -> 201 ok' 201 - "$S1" "$C1"
if [ -f "$DB" ] && [ "$(db_count "SELECT COUNT(*) FROM placements")" = 16 ]; then
  pass 'valid submit: schema created, 8 characters x 2 axes stored'
else
  fail 'valid submit: schema created, 8 characters x 2 axes stored' "placements rows: $(db_count 'SELECT COUNT(*) FROM placements' 2>&1)"
fi
submit_case 'duplicate (same session and clientId) -> 409 already_submitted' 409 already_submitted "$S1" "$C1"
submit_case 'same clientId in another session -> 201' 201 - K7MP3R "$C1"

# --- session --------------------------------------------------------------

submit_case 'session lowercase -> 400 invalid_session' 400 invalid_session k7mp3q "$(uuid)"
submit_case 'session with O (excluded letter) -> 400 invalid_session' 400 invalid_session K7MO3Q "$(uuid)"
submit_case 'session with 1 (excluded digit) -> 400 invalid_session' 400 invalid_session K7M13Q "$(uuid)"
submit_case 'session 7 characters -> 400 invalid_session' 400 invalid_session K7MP3QA "$(uuid)"
submit_case 'session with trailing newline -> 400 invalid_session' 400 invalid_session X "$(uuid)" 'b.session = "K7MP3Q\n"'
submit_case 'session as number -> 400 invalid_session' 400 invalid_session X "$(uuid)" 'b.session = 234567'
submit_case 'session missing -> 400 invalid_session' 400 invalid_session X "$(uuid)" 'delete b.session'

# --- clientId -------------------------------------------------------------

submit_case 'clientId uppercase -> 400 invalid_client' 400 invalid_client "$S1" "$(uuid | tr a-f A-F)"
submit_case 'clientId version 1 -> 400 invalid_client' 400 invalid_client "$S1" 6f1c2a7e-3b4d-1c5e-8f90-a1b2c3d4e5f6
submit_case 'clientId bad variant -> 400 invalid_client' 400 invalid_client "$S1" 6f1c2a7e-3b4d-4c5e-cf90-a1b2c3d4e5f6
submit_case 'clientId without hyphens -> 400 invalid_client' 400 invalid_client "$S1" 6f1c2a7e3b4d4c5e8f90a1b2c3d4e5f6
submit_case 'clientId with trailing newline -> 400 invalid_client' 400 invalid_client "$S1" X 'b.clientId = "6f1c2a7e-3b4d-4c5e-8f90-a1b2c3d4e5f6\n"'
submit_case 'clientId missing -> 400 invalid_client' 400 invalid_client "$S1" X 'delete b.clientId'

# --- values -----------------------------------------------------------------

submit_case 'value 101 -> 400 invalid_placements' 400 invalid_placements "$S1" "$(uuid)" 'b.placements[ids[0]].samr = 101'
submit_case 'value -1 -> 400 invalid_placements' 400 invalid_placements "$S1" "$(uuid)" 'b.placements[ids[1]].rogers = -1'
submit_case 'value 42.5 -> 400 invalid_placements' 400 invalid_placements "$S1" "$(uuid)" 'b.placements[ids[0]].samr = 42.5'
submit_case 'value 42.0 (JSON float) -> 400 invalid_placements' 400 invalid_placements "$S1" "$(uuid)" 'b.placements[ids[0]].samr = "__RAW__"' '42.0'
submit_case 'value 4.2e1 -> 400 invalid_placements' 400 invalid_placements "$S1" "$(uuid)" 'b.placements[ids[0]].samr = "__RAW__"' '4.2e1'
submit_case 'value "42" (string) -> 400 invalid_placements' 400 invalid_placements "$S1" "$(uuid)" 'b.placements[ids[0]].samr = "42"'
submit_case 'value true -> 400 invalid_placements' 400 invalid_placements "$S1" "$(uuid)" 'b.placements[ids[0]].rogers = true'
submit_case 'value null -> 400 invalid_placements' 400 invalid_placements "$S1" "$(uuid)" 'b.placements[ids[0]].rogers = null'
submit_case 'axis missing -> 400 invalid_placements' 400 invalid_placements "$S1" "$(uuid)" 'delete b.placements[ids[0]].rogers'
submit_case 'extra axis key -> 400 invalid_placements' 400 invalid_placements "$S1" "$(uuid)" 'b.placements[ids[0]].tpack = 5'
submit_case 'placement not an object -> 400 invalid_placements' 400 invalid_placements "$S1" "$(uuid)" 'b.placements[ids[0]] = [10, 20]'
submit_case 'placements an array -> 400 invalid_placements' 400 invalid_placements "$S1" "$(uuid)" 'b.placements = []'
submit_case 'placements missing -> 400 invalid_placements' 400 invalid_placements "$S1" "$(uuid)" 'delete b.placements'

# --- characters ---------------------------------------------------------------

submit_case 'unknown character -> 400 unknown_character' 400 unknown_character "$S1" "$(uuid)" 'b.placements.soren = { samr: 1, rogers: 2 }'
submit_case 'character id with wrong case -> 400 unknown_character' 400 unknown_character "$S1" "$(uuid)" 'b.placements.Mette = b.placements.mette; delete b.placements.mette'
submit_case 'missing character -> 400 incomplete' 400 incomplete "$S1" "$(uuid)" 'delete b.placements[ids[ids.length - 1]]'
submit_case 'empty placements -> 400 incomplete' 400 incomplete "$S1" "$(uuid)" 'b.placements = {}'

# --- JSON -----------------------------------------------------------------------

printf '{"session": "K7MP3Q",' > "$TMP/req.json"
request POST submit.php "$TMP/req.json"
expect 'truncated JSON -> 400 bad_json' 400 bad_json
printf '[1, 2, 3]' > "$TMP/req.json"
request POST submit.php "$TMP/req.json"
expect 'top-level array -> 400 bad_json' 400 bad_json
: > "$TMP/req.json"
request POST submit.php "$TMP/req.json"
expect 'empty body -> 400 bad_json' 400 bad_json

# --- body size ------------------------------------------------------------------

make_body "$TMP/req.json" "$S1" "$(uuid)" 'b.pad = "x".repeat(16384)'
request POST submit.php "$TMP/req.json"
expect 'oversized body (16 KB + JSON) -> 413 too_large' 413 too_large
request POST submit.php "$TMP/req.json" -H 'Transfer-Encoding: chunked'
expect 'oversized chunked body (no Content-Length) -> 413 too_large' 413 too_large
make_body "$TMP/req.json" "$S1" "$(uuid)" 'b.pad = ""; b.pad = "x".repeat(16384 - JSON.stringify(b).length)'
size="$(wc -c < "$TMP/req.json" | tr -d ' ')"
request POST submit.php "$TMP/req.json"
expect "body of exactly 16384 bytes ($size) -> 201 (unknown top-level keys ignored)" 201 -

# --- methods ----------------------------------------------------------------------

request GET submit.php
expect 'GET submit.php -> 405 method' 405 method
[ "$(header_value Allow)" = POST ] && pass 'GET submit.php: Allow: POST' || fail 'GET submit.php: Allow: POST' "Allow '$(header_value Allow)'"
request PUT submit.php
expect 'PUT submit.php -> 405 method' 405 method
make_body "$TMP/req.json" "$S1" "$(uuid)"
request POST 'results.php?session=K7MP3Q' "$TMP/req.json"
expect 'POST results.php -> 405 method' 405 method
[ "$(header_value Allow)" = GET ] && pass 'POST results.php: Allow: GET' || fail 'POST results.php: Allow: GET' "Allow '$(header_value Allow)'"
request DELETE 'results.php?session=K7MP3Q'
expect 'DELETE results.php -> 405 method' 405 method

# --- results ------------------------------------------------------------------------

request GET 'results.php?session=k7mp3q'
expect 'results lowercase session -> 400 invalid_session' 400 invalid_session
request GET 'results.php'
expect 'results without session -> 400 invalid_session' 400 invalid_session
request GET 'results.php?session[]=K7MP3Q'
expect 'results session as array -> 400 invalid_session' 400 invalid_session

# check_results NAME NODE_ASSERTION: runs a JS expression with `r` (the parsed
# body) and `ids`; it must return true.
check_results() {
  local name="$1" problem
  if [ "$STATUS" != 200 ]; then fail "$name" "status $STATUS"; return; fi
  problem="$(header_problem)"
  if [ -n "$problem" ]; then fail "$name" "header $problem"; return; fi
  problem="$(node -e '
    const fs = require("fs");
    const [file, expr, charsPath] = process.argv.slice(1);
    const ids = JSON.parse(fs.readFileSync(charsPath, "utf8")).characters.map((c) => c.id);
    const r = JSON.parse(fs.readFileSync(file, "utf8"));
    const shapeOk = r.ok === true && typeof r.n === "number"
      && JSON.stringify(Object.keys(r.characters)) === JSON.stringify(ids)
      && ids.every((id) => Object.keys(r.characters[id]).join() === "samr,rogers");
    if (!shapeOk) console.log("bad shape: " + JSON.stringify(r).slice(0, 200));
    else if (!new Function("r", "ids", "return (" + expr + ");")(r, ids)) console.log("assertion failed on " + JSON.stringify(r).slice(0, 300));
  ' "$BODY" "$2" "$ROOT/public/content/characters.json")"
  if [ -n "$problem" ]; then fail "$name" "$problem"; else pass "$name"; fi
}

request GET 'results.php?session=ZZZZZZ'
check_results 'results unknown session -> 200, n 0, empty arrays' \
  'r.session === "ZZZZZZ" && r.n === 0 && ids.every((id) => r.characters[id].samr.length === 0 && r.characters[id].rogers.length === 0)'

S2=AGGR23
submit_case 'aggregate: first client -> 201' 201 - "$S2" "$(uuid)" \
  'ids.forEach((id) => { b.placements[id] = { samr: 80, rogers: 5 }; }); b.placements.mette = { samr: 55, rogers: 30 }'
submit_case 'aggregate: second client -> 201' 201 - "$S2" "$(uuid)" \
  'ids.forEach((id) => { b.placements[id] = { samr: 10, rogers: 100 }; }); b.placements.mette = { samr: 42, rogers: 18 }'
request GET "results.php?session=$S2"
check_results 'aggregate: n 2, arrays sorted ascending, values exact' \
  'r.session === "AGGR23" && r.n === 2
   && JSON.stringify(r.characters.mette) === JSON.stringify({ samr: [42, 55], rogers: [18, 30] })
   && ids.filter((id) => id !== "mette").every((id) => JSON.stringify(r.characters[id]) === JSON.stringify({ samr: [10, 80], rogers: [5, 100] }))'
request GET "results.php?session=$S2"
check_results 'aggregate: n equals the length of every value array (one snapshot)' \
  'ids.every((id) => r.characters[id].samr.length === r.n && r.characters[id].rogers.length === r.n)'
# n and the arrays come from one query, so they describe the same snapshot; its LEFT JOIN must
# still count a submission row that has no placement rows.
sqlite3 "$DB" "INSERT INTO submissions (session_code, client_id, created_at) VALUES ('EMPT23', '$(uuid)', datetime('now'));"
request GET 'results.php?session=EMPT23'
check_results 'one query: a submission without placements counts in n, arrays stay empty' \
  'r.n === 1 && ids.every((id) => r.characters[id].samr.length === 0 && r.characters[id].rogers.length === 0)'
request GET "results.php?session=$S1"
check_results 'aggregate: other sessions stay separate (K7MP3Q n 2)' 'r.n === 2'

# --- retention ----------------------------------------------------------------------

S3=RETN45
OLD="$(uuid)"
KEEP="$(uuid)"
submit_case 'retention: submission to back-date -> 201' 201 - "$S3" "$OLD"
submit_case 'retention: submission to keep -> 201' 201 - "$S3" "$KEEP"
sqlite3 "$DB" "UPDATE submissions SET created_at = datetime('now', '-31 days') WHERE client_id = '$OLD';
               UPDATE submissions SET created_at = datetime('now', '-29 days') WHERE client_id = '$KEEP';"
old_id="$(db_count "SELECT id FROM submissions WHERE client_id = '$OLD'")"
request GET "results.php?session=$S3"
check_results 'retention: results leave out the 31-day-old submission before cleanup' 'r.n === 1'
submit_case 'retention: next submit -> 201' 201 - "$S3" "$(uuid)"
left="$(db_count "SELECT (SELECT COUNT(*) FROM submissions WHERE client_id = '$OLD') || ',' || (SELECT COUNT(*) FROM placements WHERE submission_id = $old_id) || ',' || (SELECT COUNT(*) FROM submissions WHERE client_id = '$KEEP')")"
if [ "$left" = '0,0,1' ]; then
  pass 'retention: 31-day-old submission and its placements deleted, 29-day-old kept'
else
  fail 'retention: 31-day-old submission and its placements deleted, 29-day-old kept' "old submission, old placements, kept submission = $left"
fi
request GET "results.php?session=$S3"
check_results 'retention: results n 2 after cleanup' 'r.n === 2'

# --- session cap ----------------------------------------------------------------------

set_overrides '{"max_submissions_per_session": 3}'
S4=CAPS67
CAP1="$(uuid)"
submit_case 'cap 3: submit 1 -> 201' 201 - "$S4" "$CAP1"
submit_case 'cap 3: submit 2 -> 201' 201 - "$S4" "$(uuid)"
submit_case 'cap 3: submit 3 -> 201' 201 - "$S4" "$(uuid)"
submit_case 'cap 3: submit 4 -> 429 session_full' 429 session_full "$S4" "$(uuid)"
submit_case 'cap 3: repeat of submit 1 -> 409 already_submitted' 409 already_submitted "$S4" "$CAP1"
submit_case 'cap 3: other session unaffected -> 201' 201 - CAPS68 "$(uuid)"
request GET "results.php?session=$S4"
check_results 'cap 3: results n 3, every array has 3 values' 'r.n === 3 && ids.every((id) => r.characters[id].samr.length === 3 && r.characters[id].rogers.length === 3)'
set_overrides '{}'

# --- api_enabled false again, with data present ---------------------------------------

set_overrides '{"api_enabled": false}'
request GET "results.php?session=$S2"
expect 'closed with data: GET results.php -> 503 closed' 503 closed
submit_case 'closed with data: POST submit.php -> 503 closed' 503 closed "$S2" "$(uuid)"
set_overrides '{}'

# --- server errors (details only in the server log) ---------------------------------------

set_overrides "{\"dsn\": \"sqlite:$TMP/missing-dir/x.sqlite\"}"
request GET "results.php?session=$S2"
expect 'unreachable database: GET results.php -> 500 server' 500 server
submit_case 'unreachable database: POST submit.php -> 500 server' 500 server "$S2" "$(uuid)"
set_overrides '{"retention_days": "30"}'
request GET "results.php?session=$S2"
expect 'invalid config value: GET results.php -> 500 server' 500 server
set_overrides '{}'

# --- lib.php is not an endpoint -----------------------------------------------------------

lib_status="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/lib.php")"
[ "$lib_status" = 404 ] && pass 'GET lib.php -> 404' || fail 'GET lib.php -> 404' "status $lib_status"

echo
echo "$PASSED passed, $FAILED failed"
[ "$FAILED" = 0 ]

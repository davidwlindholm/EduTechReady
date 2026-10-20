#!/usr/bin/env bash
# Builds the upload package: dist/lounge-<YYYY-MM-DD>.zip.
#
# Usage: scripts/package.sh            (prints the path of the zip)
# Needs: bash, rsync, zip, php (for a syntax check of the rewritten lib.php).
#
# The zip holds one folder, edutechready/, whose contents go into the site's
# /edutechready/ folder as they are (docs/DEPLOY.md):
#
#   edutechready/
#     index.html, results.html, facilitator.html, css/, js/, vendor/,
#     assets/, content/, api/ (with .htaccess and .user.ini), .htaccess
#     private/   config.example.php, .htaccess (Require all denied)
#     db/        schema.mysql.sql, schema.sqlite.sql, .htaccess (denied)
#     DEPLOY.md, README.md  (denied by .htaccess, like every .md file)
#     LICENSE    the AGPL text (README.md has the licence of each part)
#
# The host has no space outside the web root, so private/ and db/
# sit inside the game folder. In development they sit next to public/, one
# level higher, which is what LOUNGE_CONFIG_PATH in api/lib.php points at by
# default. The packaged copy of lib.php has that constant, and
# LOUNGE_SQLITE_SCHEMA_PATH, rewritten to the package layout. The repository
# copy is never changed.
#
# Left out: public/dev/ (developer pages), .gitkeep and .DS_Store files,
# private/config.php (real settings) and any SQLite database.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
NAME="lounge-$(date +%Y-%m-%d)"
ZIP="$DIST/$NAME.zip"
APP="edutechready"

for tool in rsync zip php; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "package.sh: $tool is required but not installed" >&2
    exit 2
  fi
done

if [ -n "$(git -C "$ROOT" status --porcelain --untracked-files=all -- public private/config.example.php db/schema.mysql.sql docs/DEPLOY.md LICENSE README.md 2>/dev/null)" ]; then
  echo "package.sh: warning: uncommitted changes under public/ or in packaged files; they are included as they are" >&2
fi

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/edutechready-package.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
OUT="$STAGE/$APP"
mkdir -p "$OUT/private" "$OUT/db"

rsync -a \
  --exclude '/dev/' \
  --exclude '.gitkeep' \
  --exclude '.DS_Store' \
  "$ROOT/public/" "$OUT/"

cp "$ROOT/private/config.example.php" "$ROOT/private/.htaccess" "$OUT/private/"
cp "$ROOT/db/schema.mysql.sql" "$ROOT/db/schema.sqlite.sql" "$ROOT/db/.htaccess" "$OUT/db/"
cp "$ROOT/docs/DEPLOY.md" "$OUT/DEPLOY.md"
cp "$ROOT/LICENSE" "$ROOT/README.md" "$OUT/"

# Point the packaged lib.php at private/ and db/ inside the game folder.
LIB="$OUT/api/lib.php"
rewrite() {
  local from="$1" to="$2"
  if [ "$(grep -cF -- "$from" "$LIB")" != "1" ]; then
    echo "package.sh: expected exactly one line with: $from" >&2
    exit 1
  fi
  local escaped_from escaped_to
  escaped_from="$(printf '%s' "$from" | sed 's/[][\\.*^$/|]/\\&/g')"
  escaped_to="$(printf '%s' "$to" | sed 's/[\\&|]/\\&/g')"
  sed -i.bak "s|$escaped_from|$escaped_to|" "$LIB"
  rm -f "$LIB.bak"
}
rewrite "const LOUNGE_CONFIG_PATH = __DIR__ . '/../../private/config.php';" \
        "const LOUNGE_CONFIG_PATH = __DIR__ . '/../private/config.php';"
rewrite "const LOUNGE_SQLITE_SCHEMA_PATH = __DIR__ . '/../../db/schema.sqlite.sql';" \
        "const LOUNGE_SQLITE_SCHEMA_PATH = __DIR__ . '/../db/schema.sqlite.sql';"
php -l "$LIB" >/dev/null

# Nothing secret or development-only may slip in.
for forbidden in "private/config.php" "dev"; do
  if [ -e "$OUT/$forbidden" ]; then
    echo "package.sh: $forbidden must not be in the package" >&2
    exit 1
  fi
done
if find "$OUT" -name '*.sqlite' -o -name '*.sqlite-*' | grep -q .; then
  echo "package.sh: a SQLite database must not be in the package" >&2
  exit 1
fi

mkdir -p "$DIST"
rm -f "$ZIP"
(cd "$STAGE" && zip -qrX "$ZIP" "$APP")
echo "$ZIP"

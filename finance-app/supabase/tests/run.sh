#!/usr/bin/env bash
# Runs the migration and RLS tests against a throwaway local Postgres database.
# Uses PG* environment variables (default: local socket, user postgres).
set -euo pipefail
cd "$(dirname "$0")/.."
DB="ledgerline_test_$$"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
"${PSQL[@]}" -d "$DB" -f tests/bootstrap.sql
for f in migrations/*.sql; do "${PSQL[@]}" -d "$DB" -f "$f"; done
"${PSQL[@]}" -d "$DB" -f tests/rls.sql

#!/usr/bin/env bash
# Proves a backup can be restored and is consistent. Dumps SOURCE_DATABASE_URL, restores it into a
# scratch database on the same server, compares row counts for every table, re-checks the
# attendance rules the database enforces, then drops the scratch database.
#
#   SOURCE_DATABASE_URL=postgres://user:pass@host:5432/guest_platform scripts/restore-check.sh
#
# Needs pg_dump, pg_restore and psql (client 16), and permission to create a database. Run it
# against a copy or a replica in staging, not against production traffic. The dump file holds
# guest personal data: it is written to a private temporary directory and deleted on exit.
set -euo pipefail

: "${SOURCE_DATABASE_URL:?set SOURCE_DATABASE_URL}"
scratch="gp_restore_check_$(date +%s)"
work="$(mktemp -d)"
chmod 700 "$work"
admin_url="${SOURCE_DATABASE_URL%/*}/postgres"
scratch_url="${SOURCE_DATABASE_URL%/*}/${scratch}"

cleanup() {
  psql "$admin_url" -qc "drop database if exists \"$scratch\"" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

start=$(date +%s)
pg_dump --format=custom --no-owner --file="$work/backup.dump" "$SOURCE_DATABASE_URL"
dumped=$(date +%s)
psql "$admin_url" -qc "create database \"$scratch\"" 
pg_restore --no-owner --exit-on-error --dbname="$scratch_url" "$work/backup.dump"
restored=$(date +%s)

counts() {
  psql "$1" -Atq -c "
    select format('%I.%I', schemaname, relname) || ' ' ||
           (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, relname), false, true, '')))[1]::text
    from pg_stat_user_tables where schemaname in ('public','pgboss') order by 1"
}
counts "$SOURCE_DATABASE_URL" > "$work/source.txt"
counts "$scratch_url" > "$work/restored.txt"
if ! diff -u "$work/source.txt" "$work/restored.txt"; then
  echo "FAIL: row counts differ" >&2
  exit 1
fi
tables=$(wc -l < "$work/source.txt" | tr -d ' ')

# Rules that must survive a restore: the ledger still adds up to the attendance projection, and
# the append-only trigger on the ledger still refuses updates.
mismatch=$(psql "$scratch_url" -Atq -c "
  select count(*) from attendance a
  where a.checked_in_count <> coalesce((select sum(count_delta) from check_in_logs l where l.guest_id = a.guest_id), 0)")
if [ "$mismatch" != "0" ]; then
  echo "FAIL: $mismatch attendance rows disagree with the ledger" >&2
  exit 1
fi
if psql "$scratch_url" -qc "update check_in_logs set reason = 'x'" >/dev/null 2>&1; then
  echo "FAIL: ledger accepted an update after restore" >&2
  exit 1
fi

echo "OK: $tables tables match; ledger consistent; ledger still append-only"
echo "dump $((dumped - start))s, restore $((restored - dumped))s"

#!/usr/bin/env bash
# Drives a portable PostgreSQL server for local development.
#
# No installer, no Windows service, no admin rights: the EnterpriseDB binary
# zip is unpacked under ~/pgportable and the cluster lives in ~/pgportable/data.
# Production is Railway Postgres; this exists only so the app is runnable and
# seedable on a laptop.
#
#   bash scripts/pg.sh start | stop | status | psql | drop
set -euo pipefail

PG_HOME="${PG_HOME:-$HOME/pgportable/pgsql}"
PG_DATA="${PG_DATA:-$HOME/pgportable/data}"
PG_PORT="${PG_PORT:-55432}"
PG_LOG="${PG_LOG:-$HOME/pgportable/postgres.log}"
DB_NAME="${DB_NAME:-agency_crm}"

export PATH="$PG_HOME/bin:$PATH"

require_binaries() {
  if [ ! -x "$PG_HOME/bin/pg_ctl.exe" ] && [ ! -x "$PG_HOME/bin/pg_ctl" ]; then
    echo "Postgres binaries not found at $PG_HOME" >&2
    echo "Download and unzip:" >&2
    echo "  https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64-binaries.zip" >&2
    exit 1
  fi
}

case "${1:-start}" in
  start)
    require_binaries
    if [ ! -f "$PG_DATA/PG_VERSION" ]; then
      echo "Initialising cluster at $PG_DATA"
      initdb -D "$PG_DATA" -U postgres --auth=trust --encoding=UTF8 >/dev/null
    fi
    if pg_ctl -D "$PG_DATA" status >/dev/null 2>&1; then
      echo "Already running on port $PG_PORT"
    else
      # The postmaster inherits the shell's stdio handles, and Git Bash will
      # not return until every handle closes. Detach all three explicitly.
      pg_ctl -D "$PG_DATA" -l "$PG_LOG" -o "-p $PG_PORT" -w start \
        </dev/null >/dev/null 2>&1
      echo "Started on port $PG_PORT (log: $PG_LOG)"
    fi
    createdb -h 127.0.0.1 -p "$PG_PORT" -U postgres "$DB_NAME" 2>/dev/null \
      && echo "Created database $DB_NAME" \
      || echo "Database $DB_NAME already exists"
    echo
    echo "DATABASE_URL=postgresql://postgres@127.0.0.1:$PG_PORT/$DB_NAME"
    ;;
  stop)
    require_binaries
    pg_ctl -D "$PG_DATA" -m fast -w stop
    ;;
  status)
    require_binaries
    pg_ctl -D "$PG_DATA" status || true
    ;;
  psql)
    require_binaries
    psql -h 127.0.0.1 -p "$PG_PORT" -U postgres -d "$DB_NAME"
    ;;
  drop)
    require_binaries
    dropdb -h 127.0.0.1 -p "$PG_PORT" -U postgres --if-exists "$DB_NAME"
    createdb -h 127.0.0.1 -p "$PG_PORT" -U postgres "$DB_NAME"
    echo "Recreated $DB_NAME"
    ;;
  *)
    echo "usage: bash scripts/pg.sh {start|stop|status|psql|drop}" >&2
    exit 1
    ;;
esac

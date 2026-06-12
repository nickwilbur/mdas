#!/bin/bash
# Start/stop/status helpers for local (non-Docker) web + worker processes.
#
# Uses detached GNU screen sessions so web + worker survive closing the
# terminal or Cursor agent tearing down the invoking shell. Plain
# background jobs, nohup, and double-fork were not reliable when the IDE
# aborted the parent session.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_LOG=/tmp/mdas-web.log
WORKER_LOG=/tmp/mdas-worker.log
WEB_PID_FILE=/tmp/mdas-web.pid
WORKER_PID_FILE=/tmp/mdas-worker.pid
WEB_SCREEN=mdas-web
WORKER_SCREEN=mdas-worker
WEB_PORT=3000

load_env() {
  if [[ ! -f "$REPO_ROOT/.env" ]]; then
    echo "❌ .env not found at $REPO_ROOT/.env" >&2
    return 1
  fi
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
}

screen_running() {
  local session=$1
  local listing
  # screen -ls exits 1 when sessions exist; avoid pipefail false negatives.
  listing="$(screen -ls 2>/dev/null || true)"
  grep -qF ".${session}" <<<"$listing"
}

stop_screen() {
  local session=$1
  if screen_running "$session"; then
    screen -S "$session" -X quit 2>/dev/null || true
  fi
}

# Start a long-running command in a detached screen session.
start_screen() {
  local session=$1
  local logfile=$2
  local workdir=$3
  shift 3
  stop_screen "$session"
  : >"$logfile"
  screen -dmS "$session" bash -lc "
    cd '$workdir'
    set -a
    source '$REPO_ROOT/.env'
    set +a
    exec \"\$@\" >>'$logfile' 2>&1
  " bash "$@"
}

stop_processes() {
  echo "🛑 Stopping existing processes..."
  stop_screen "$WEB_SCREEN"
  stop_screen "$WORKER_SCREEN"
  if [[ -f "$WEB_PID_FILE" ]]; then
    kill "$(cat "$WEB_PID_FILE")" 2>/dev/null || true
  fi
  if [[ -f "$WORKER_PID_FILE" ]]; then
    kill "$(cat "$WORKER_PID_FILE")" 2>/dev/null || true
  fi
  pkill -f "next dev" 2>/dev/null || true
  pkill -f "tsx src/main.ts" 2>/dev/null || true
  rm -f "$WEB_PID_FILE" "$WORKER_PID_FILE"
}

wait_for_web() {
  local i
  for i in $(seq 1 30); do
    if curl -sf "http://localhost:${WEB_PORT}/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

web_pid() {
  lsof -ti ":${WEB_PORT}" -sTCP:LISTEN 2>/dev/null | head -1 || true
}

worker_pid() {
  pgrep -f "tsx src/main.ts" 2>/dev/null | head -1 || true
}

clear_production_next_cache() {
  local next_dir="$REPO_ROOT/apps/web/.next"
  # `next build` leaves production artifacts in .next. If `next dev` starts
  # against that cache, HTML renders but /_next/static/css and chunks 404.
  if [[ -f "$next_dir/BUILD_ID" || -f "$next_dir/export-marker.json" ]]; then
    echo "🧹 Clearing production .next cache (required before dev)..."
    rm -rf "$next_dir"
  fi
}

start_web() {
  clear_production_next_cache
  echo "🌐 Starting web server (screen session: $WEB_SCREEN)..."
  start_screen "$WEB_SCREEN" "$WEB_LOG" "$REPO_ROOT" \
    npm run dev:web

  echo "⏳ Waiting for web server to be ready..."
  if ! wait_for_web; then
    echo "❌ Web server failed to become ready. Check logs: cat $WEB_LOG" >&2
    tail -20 "$WEB_LOG" >&2 || true
    return 1
  fi

  local pid
  pid="$(web_pid)"
  if [[ -z "$pid" ]]; then
    echo "❌ Web server is responding but no listener PID found on :${WEB_PORT}" >&2
    return 1
  fi
  echo "$pid" >"$WEB_PID_FILE"
  echo "✅ Web server is ready (PID: $pid, screen: $WEB_SCREEN)"
}

start_worker() {
  echo "👷 Starting worker (screen session: $WORKER_SCREEN)..."
  start_screen "$WORKER_SCREEN" "$WORKER_LOG" "$REPO_ROOT" \
    npm run dev:worker

  echo "⏳ Waiting for worker to be ready..."
  local i pid
  for i in $(seq 1 15); do
    pid="$(worker_pid)"
    if [[ -n "$pid" ]]; then
      echo "$pid" >"$WORKER_PID_FILE"
      echo "✅ Worker is running (PID: $pid, screen: $WORKER_SCREEN)"
      return 0
    fi
    sleep 1
  done

  echo "❌ Worker failed to start. Check logs: cat $WORKER_LOG" >&2
  tail -20 "$WORKER_LOG" >&2 || true
  return 1
}

status() {
  local wp ww
  wp="$(web_pid)"
  ww="$(worker_pid)"
  if screen_running "$WEB_SCREEN"; then
    echo "web screen: $WEB_SCREEN (detached)"
  else
    echo "web screen: not running"
  fi
  if [[ -n "$wp" ]]; then
    echo "web: running (pid $wp, http://localhost:${WEB_PORT})"
  else
    echo "web: not running"
  fi
  if screen_running "$WORKER_SCREEN"; then
    echo "worker screen: $WORKER_SCREEN (detached)"
  else
    echo "worker screen: not running"
  fi
  if [[ -n "$ww" ]]; then
    echo "worker: running (pid $ww)"
  else
    echo "worker: not running"
  fi
}

case "${1:-}" in
  stop) stop_processes ;;
  status) status ;;
  start)
    load_env
    stop_processes
    start_web
    start_worker
    ;;
  *)
    echo "Usage: $0 {start|stop|status}" >&2
    exit 1
    ;;
esac

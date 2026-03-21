#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

cleanup() {
  local exit_code=$?

  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "${WEB_PID:-}" ]]; then
    kill "$WEB_PID" >/dev/null 2>&1 || true
  fi

  if [[ -n "${WORKER_PID:-}" ]]; then
    kill "$WORKER_PID" >/dev/null 2>&1 || true
  fi

  exit "$exit_code"
}

trap cleanup INT TERM EXIT

if ! command -v node >/dev/null 2>&1; then
  echo "[DramaFlow] Node.js was not found in PATH."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[DramaFlow] npm was not found in PATH."
  exit 1
fi

if [[ ! -f ".env" ]]; then
  echo "[DramaFlow] .env not found. Copying from .env.example..."
  cp ".env.example" ".env"
fi

if [[ ! -d "node_modules" ]]; then
  echo "[DramaFlow] node_modules not found. Installing dependencies..."
  npm install
fi

echo "[DramaFlow] Building workspace..."
npm run build

echo "[DramaFlow] Starting API, Web, and Worker..."
npm --workspace @dramaflow/api run start > api.log 2> api.err.log &
API_PID=$!
npm --workspace @dramaflow/web run start > web.log 2> web.err.log &
WEB_PID=$!
npm --workspace @dramaflow/worker run start > worker.log 2> worker.err.log &
WORKER_PID=$!

echo
echo "[DramaFlow] Web: http://localhost:3000"
echo "[DramaFlow] Login: http://localhost:3000/login"
echo "[DramaFlow] API: http://localhost:4000/health"
echo "[DramaFlow] Swagger: http://localhost:4000/docs"
echo "[DramaFlow] Logs: api.log / web.log / worker.log"
echo "[DramaFlow] Press Ctrl+C to stop all three services."
echo

wait "$API_PID" "$WEB_PID" "$WORKER_PID"

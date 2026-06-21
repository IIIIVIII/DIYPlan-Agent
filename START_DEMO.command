#!/bin/zsh
# Double-click launcher: starts the local MLX model backend (if installed)
# and the Node web app together, then opens the browser.
#
# - If ml/.venv exists, the Apple Silicon model backend starts on :8000 and
#   the "Local MLX" routing strategy becomes available in the UI.
# - If it does not exist, the app still runs in cloud/mock mode.
#
# Set DIYPLAN_ML_MOCK=1 before launching to start the backend without loading
# the ~2.5GB vision model (fast, deterministic, good for a quick demo).

cd "$(dirname "$0")"

PORT="${PORT:-5173}"
ML_PORT="${DIYPLAN_ML_PORT:-8000}"
ML_HOST="127.0.0.1"
ML_PID=""

cleanup() {
  echo ""
  echo "Shutting down DIYPlan Agent..."
  [ -n "$ML_PID" ] && kill "$ML_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

echo "=============================================="
echo " DIYPlan Agent - launching full local stack"
echo "=============================================="

# 1) Local MLX backend (perception + RAG + planning) -------------------------
if [ -x "ml/.venv/bin/python" ]; then
  echo "[1/2] Starting local MLX backend on http://${ML_HOST}:${ML_PORT}"
  echo "      logs -> ml/backend.log   (mock=${DIYPLAN_ML_MOCK:-0})"
  ml/.venv/bin/python -m uvicorn ml.app:app --host "$ML_HOST" --port "$ML_PORT" \
    > ml/backend.log 2>&1 &
  ML_PID=$!

  # Tell the Node app where the backend lives so the Local MLX strategy works.
  export ML_BACKEND_URL="http://${ML_HOST}:${ML_PORT}"

  printf "      waiting for backend"
  for i in {1..25}; do
    if curl -s "http://${ML_HOST}:${ML_PORT}/health" >/dev/null 2>&1; then
      echo " ... ready"
      break
    fi
    printf "."
    sleep 1
  done
  echo "      Note: the first 'Local MLX' request loads the model and is slow (~1-2 min)."
else
  echo "[1/2] ml/.venv not found -> skipping local backend (cloud/mock mode only)."
  echo "      To enable local models:"
  echo "        python3 -m venv ml/.venv"
  echo "        ml/.venv/bin/pip install -r ml/requirements.txt"
  echo "        ml/.venv/bin/python -m ml.ingest"
fi

# 2) Node web app ------------------------------------------------------------
echo "[2/2] Starting web app on http://localhost:${PORT}"
( sleep 2; open "http://localhost:${PORT}" ) &
npm run dev

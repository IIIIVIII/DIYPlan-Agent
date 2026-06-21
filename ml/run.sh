#!/usr/bin/env bash
# Start the local ML backend on Apple Silicon.
#
#   ./ml/run.sh            # live mode (loads MLX models, downloads on first run)
#   DIYPLAN_ML_MOCK=1 ./ml/run.sh   # mock mode (no model download)
#
# Run from the project root so the `ml` package imports correctly.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -d "ml/.venv" ]; then
  # shellcheck disable=SC1091
  source ml/.venv/bin/activate
fi

HOST="${DIYPLAN_ML_HOST:-127.0.0.1}"
PORT="${DIYPLAN_ML_PORT:-8000}"

echo "Starting DIYPlan ML backend on http://${HOST}:${PORT} (mock=${DIYPLAN_ML_MOCK:-0})"
exec python -m uvicorn ml.app:app --host "${HOST}" --port "${PORT}"

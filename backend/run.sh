#!/usr/bin/env bash
# Start the API on http://localhost:8000  (docs at /docs)
set -euo pipefail
cd "$(dirname "$0")"
exec uv run uvicorn app.main:app --reload --port 8000

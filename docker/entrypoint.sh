#!/bin/sh
set -eu

APP_ROOT="/app"
DATA_ROOT="${DATA_ROOT:-${APP_ROOT}/data}"
LOG_DIR="${DATA_ROOT}/logs"

mkdir -p "${DATA_ROOT}/projects" "${LOG_DIR}"

echo "Starting LLM Wiki with DATA_ROOT=${DATA_ROOT}"

node server/src/app.js 2>&1 | tee -a "${LOG_DIR}/server.log"

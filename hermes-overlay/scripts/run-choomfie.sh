#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OVERLAY_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd -- "${OVERLAY_DIR}/.." && pwd)"
ENV_FILE="${CHOOMFIE_HERMES_ENV:-${REPO_DIR}/.env.hermes}"
HOME_ENV_FILE="${CHOOMFIE_HERMES_HOME:-${HOME}/.choomfie-hermes}/.env"
ORIG_CHO_HOME="${CHOOMFIE_HERMES_HOME:-}"
ORIG_API_KEY="${API_SERVER_KEY:-}"
ORIG_API_HOST="${API_SERVER_HOST:-}"
ORIG_API_PORT="${API_SERVER_PORT:-}"
ORIG_API_ENABLED="${API_SERVER_ENABLED:-}"
ORIG_API_MODEL="${API_SERVER_MODEL_NAME:-}"
ORIG_HERMES_BIN="${HERMES_BIN:-}"

for source_file in "${ENV_FILE}" "${HOME_ENV_FILE}"; do
if [[ -f "${source_file}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${source_file}"
  set +a
fi
done

[[ -n "${ORIG_CHO_HOME}" ]] && CHOOMFIE_HERMES_HOME="${ORIG_CHO_HOME}"
[[ -n "${ORIG_API_KEY}" ]] && API_SERVER_KEY="${ORIG_API_KEY}"
[[ -n "${ORIG_API_HOST}" ]] && API_SERVER_HOST="${ORIG_API_HOST}"
[[ -n "${ORIG_API_PORT}" ]] && API_SERVER_PORT="${ORIG_API_PORT}"
[[ -n "${ORIG_API_ENABLED}" ]] && API_SERVER_ENABLED="${ORIG_API_ENABLED}"
[[ -n "${ORIG_API_MODEL}" ]] && API_SERVER_MODEL_NAME="${ORIG_API_MODEL}"
[[ -n "${ORIG_HERMES_BIN}" ]] && HERMES_BIN="${ORIG_HERMES_BIN}"

HERMES_BIN="${HERMES_BIN:-hermes}"
LOCAL_HERMES_BIN="${OVERLAY_DIR}/scripts/hermes-local.sh"
CHOOMFIE_HERMES_HOME="${CHOOMFIE_HERMES_HOME:-${HOME}/.choomfie-hermes}"
HERMES_CONFIG="${HERMES_CONFIG:-${CHOOMFIE_HERMES_HOME}/config.yaml}"
HERMES_PROFILE="${HERMES_PROFILE:-choomfie}"
API_SERVER_HOST="${API_SERVER_HOST:-127.0.0.1}"
API_SERVER_PORT="${API_SERVER_PORT:-8642}"

if ! command -v "${HERMES_BIN}" >/dev/null 2>&1; then
  if [[ -x "${LOCAL_HERMES_BIN}" ]]; then
    HERMES_BIN="${LOCAL_HERMES_BIN}"
  else
    printf 'Hermes executable not found: %s\n' "${HERMES_BIN}" >&2
    printf 'Install Hermes or set HERMES_BIN in %s.\n' "${ENV_FILE}" >&2
    exit 127
  fi
fi

mkdir -p "${CHOOMFIE_HERMES_HOME}"
if [[ ! -f "${CHOOMFIE_HERMES_HOME}/SOUL.md" ]]; then
  cp "${OVERLAY_DIR}/profiles/SOUL.md" "${CHOOMFIE_HERMES_HOME}/SOUL.md"
fi

export CHOOMFIE_HERMES_OVERLAY="${OVERLAY_DIR}"
export CHOOMFIE_HERMES_HOME
export HERMES_HOME="${CHOOMFIE_HERMES_HOME}"
export HERMES_CONFIG
export HERMES_PROFILE
export API_SERVER_ENABLED="${API_SERVER_ENABLED:-true}"
export API_SERVER_KEY="${API_SERVER_KEY:-}"
export API_SERVER_HOST
export API_SERVER_PORT
export API_SERVER_MODEL_NAME="${API_SERVER_MODEL_NAME:-choomfie}"
export HERMES_ALLOW_GLOBAL_CONFIG_WRITE="${HERMES_ALLOW_GLOBAL_CONFIG_WRITE:-0}"
export HERMES_ALLOW_UNSAFE_TOOLS="${HERMES_ALLOW_UNSAFE_TOOLS:-0}"

if [[ -z "${API_SERVER_KEY:-}" ]]; then
  printf 'Warning: API_SERVER_KEY is unset. Hermes may run without authenticated session headers.\n' >&2
fi

printf 'Starting Choomfie-Hermes\n'
printf '  overlay: %s\n' "${OVERLAY_DIR}"
printf '  home:    %s\n' "${CHOOMFIE_HERMES_HOME}"
printf '  config:  %s\n' "${HERMES_CONFIG}"
printf '  api:     http://%s:%s\n' "${API_SERVER_HOST}" "${API_SERVER_PORT}"
printf '  hermes:  %s\n' "${HERMES_BIN}"

exec "${HERMES_BIN}" gateway run

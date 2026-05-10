#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OVERLAY_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd -- "${OVERLAY_DIR}/.." && pwd)"
ENV_FILE="${CHOOMFIE_HERMES_ENV:-${REPO_DIR}/.env.hermes}"
HOME_ENV_FILE="${CHOOMFIE_HERMES_HOME:-${HOME}/.choomfie-hermes}/.env"
ORIG_CHO_HOME="${CHOOMFIE_HERMES_HOME:-}"
ORIG_HERMES_BIN="${HERMES_BIN:-}"
ORIG_API_KEY="${API_SERVER_KEY:-}"
ORIG_API_HOST="${API_SERVER_HOST:-}"
ORIG_API_PORT="${API_SERVER_PORT:-}"
ORIG_API_ENABLED="${API_SERVER_ENABLED:-}"
ORIG_API_MODEL="${API_SERVER_MODEL_NAME:-}"

for source_file in "${ENV_FILE}" "${HOME_ENV_FILE}"; do
if [[ -f "${source_file}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${source_file}"
  set +a
fi
done

[[ -n "${ORIG_CHO_HOME}" ]] && CHOOMFIE_HERMES_HOME="${ORIG_CHO_HOME}"
[[ -n "${ORIG_HERMES_BIN}" ]] && HERMES_BIN="${ORIG_HERMES_BIN}"
[[ -n "${ORIG_API_KEY}" ]] && API_SERVER_KEY="${ORIG_API_KEY}"
[[ -n "${ORIG_API_HOST}" ]] && API_SERVER_HOST="${ORIG_API_HOST}"
[[ -n "${ORIG_API_PORT}" ]] && API_SERVER_PORT="${ORIG_API_PORT}"
[[ -n "${ORIG_API_ENABLED}" ]] && API_SERVER_ENABLED="${ORIG_API_ENABLED}"
[[ -n "${ORIG_API_MODEL}" ]] && API_SERVER_MODEL_NAME="${ORIG_API_MODEL}"

export CHOOMFIE_HERMES_HOME="${CHOOMFIE_HERMES_HOME:-}"
export API_SERVER_KEY="${API_SERVER_KEY:-}"
export API_SERVER_HOST="${API_SERVER_HOST:-}"
export API_SERVER_PORT="${API_SERVER_PORT:-}"
export API_SERVER_ENABLED="${API_SERVER_ENABLED:-}"
export API_SERVER_MODEL_NAME="${API_SERVER_MODEL_NAME:-}"

INSTALL_DIR="${CHOOMFIE_HERMES_INSTALL_DIR:-${HOME}/.local/share/choomfie/hermes}"

if [[ ! -f "${INSTALL_DIR}/pyproject.toml" ]]; then
  printf 'Local Hermes checkout not found at %s\n' "${INSTALL_DIR}" >&2
  printf 'Run hermes-overlay/scripts/install-hermes.sh --local first.\n' >&2
  exit 127
fi

cd "${INSTALL_DIR}"
exec uv run hermes "$@"

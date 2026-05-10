#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OVERLAY_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd -- "${OVERLAY_DIR}/.." && pwd)"
ENV_FILE="${CHOOMFIE_HERMES_ENV:-${REPO_DIR}/.env.hermes}"
HOME_ENV_FILE="${CHOOMFIE_HERMES_HOME:-${HOME}/.choomfie-hermes}/.env"
ORIG_CHO_HOME="${CHOOMFIE_HERMES_HOME:-}"
ORIG_API_KEY="${API_SERVER_KEY:-}"
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
[[ -n "${ORIG_HERMES_BIN}" ]] && HERMES_BIN="${ORIG_HERMES_BIN}"

HERMES_BIN="${HERMES_BIN:-hermes}"
LOCAL_HERMES_BIN="${OVERLAY_DIR}/scripts/hermes-local.sh"
CHOOMFIE_HERMES_HOME="${CHOOMFIE_HERMES_HOME:-${HOME}/.choomfie-hermes}"

printf 'Choomfie-Hermes doctor\n'
printf '  overlay: %s\n' "${OVERLAY_DIR}"
printf '  env:     %s\n' "${HOME_ENV_FILE}"
printf '  home:    %s\n' "${CHOOMFIE_HERMES_HOME}"

if command -v "${HERMES_BIN}" >/dev/null 2>&1; then
  printf '  hermes:  %s\n' "$(command -v "${HERMES_BIN}")"
elif [[ -x "${LOCAL_HERMES_BIN}" ]]; then
  printf '  hermes:  %s\n' "${LOCAL_HERMES_BIN}"
else
  printf '  hermes:  missing (%s)\n' "${HERMES_BIN}"
fi

[[ -f "${OVERLAY_DIR}/profiles/SOUL.md" ]] && printf '  soul:    ok\n' || printf '  soul:    missing\n'
[[ -f "${OVERLAY_DIR}/config/config.yaml.example" ]] && printf '  config:  ok\n' || printf '  config:  missing\n'
[[ -n "${API_SERVER_KEY:-}" ]] && printf '  api key: set\n' || printf '  api key: missing\n'

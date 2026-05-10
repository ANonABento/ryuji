#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OVERLAY_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd -- "${OVERLAY_DIR}/.." && pwd)"
ENV_FILE="${CHOOMFIE_HERMES_ENV:-${REPO_DIR}/.env.hermes}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

CHOOMFIE_HERMES_HOME="${CHOOMFIE_HERMES_HOME:-${HOME}/.choomfie-hermes}"

copy_dir() {
  local src="$1"
  local dest="$2"
  rm -rf "${dest}"
  mkdir -p "$(dirname -- "${dest}")"
  cp -R "${src}" "${dest}"
}

set_env_var() {
  local key="$1"
  local value="$2"
  local env_file="${CHOOMFIE_HERMES_HOME}/.env"
  local tmp_file

  [[ -z "${value}" ]] && return 0
  tmp_file="$(mktemp)"
  if [[ -f "${env_file}" ]]; then
    grep -v "^${key}=" "${env_file}" > "${tmp_file}" || true
  fi
  printf '%s=%s\n' "${key}" "${value}" >> "${tmp_file}"
  mv "${tmp_file}" "${env_file}"
  chmod 600 "${env_file}"
}

mkdir -p "${CHOOMFIE_HERMES_HOME}"

cp "${OVERLAY_DIR}/SOUL.md" "${CHOOMFIE_HERMES_HOME}/SOUL.md"
cp "${OVERLAY_DIR}/profiles/choomfie.yaml" "${CHOOMFIE_HERMES_HOME}/choomfie.yaml"
cp "${OVERLAY_DIR}/distribution.yaml" "${CHOOMFIE_HERMES_HOME}/distribution.yaml"

if [[ ! -f "${CHOOMFIE_HERMES_HOME}/config.yaml" ]]; then
  cp "${OVERLAY_DIR}/config.yaml" "${CHOOMFIE_HERMES_HOME}/config.yaml"
fi

if [[ ! -f "${CHOOMFIE_HERMES_HOME}/.env" ]]; then
  cp "${OVERLAY_DIR}/.env.EXAMPLE" "${CHOOMFIE_HERMES_HOME}/.env"
  chmod 600 "${CHOOMFIE_HERMES_HOME}/.env"
fi

set_env_var "API_SERVER_KEY" "${API_SERVER_KEY:-}"
set_env_var "API_SERVER_HOST" "${API_SERVER_HOST:-}"
set_env_var "API_SERVER_PORT" "${API_SERVER_PORT:-}"
set_env_var "API_SERVER_ENABLED" "${API_SERVER_ENABLED:-}"
set_env_var "API_SERVER_MODEL_NAME" "${API_SERVER_MODEL_NAME:-}"

copy_dir "${OVERLAY_DIR}/skills" "${CHOOMFIE_HERMES_HOME}/skills"
copy_dir "${OVERLAY_DIR}/plugins" "${CHOOMFIE_HERMES_HOME}/plugins"
copy_dir "${OVERLAY_DIR}/toolsets" "${CHOOMFIE_HERMES_HOME}/toolsets"

printf 'Synced Choomfie overlay into %s\n' "${CHOOMFIE_HERMES_HOME}"

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

INSTALL_DIR="${CHOOMFIE_HERMES_INSTALL_DIR:-${HOME}/.local/share/choomfie/hermes}"
HERMES_VERSION="${HERMES_VERSION:-main}"

if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
  printf 'No local Hermes checkout found at %s\n' "${INSTALL_DIR}" >&2
  printf 'Run install-hermes.sh --local first, or update your external Hermes install manually.\n' >&2
  exit 1
fi

git -C "${INSTALL_DIR}" fetch --tags origin
git -C "${INSTALL_DIR}" checkout "${HERMES_VERSION}"
git -C "${INSTALL_DIR}" pull --ff-only || true

printf 'Hermes checkout updated to %s at %s\n' "${HERMES_VERSION}" "${INSTALL_DIR}"


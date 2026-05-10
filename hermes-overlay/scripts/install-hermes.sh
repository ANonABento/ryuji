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

HERMES_BIN="${HERMES_BIN:-hermes}"
HERMES_REPO="${HERMES_REPO:-https://github.com/NousResearch/hermes-agent.git}"
HERMES_VERSION="${HERMES_VERSION:-main}"
INSTALL_DIR="${CHOOMFIE_HERMES_INSTALL_DIR:-${HOME}/.local/share/choomfie/hermes}"

if command -v "${HERMES_BIN}" >/dev/null 2>&1; then
  printf 'Hermes already available at: %s\n' "$(command -v "${HERMES_BIN}")"
  exit 0
fi

if [[ "${1:-}" != "--local" ]]; then
  cat >&2 <<MSG
Hermes is not installed and this script will not modify global state by default.
Run with --local to clone the pinned Hermes ref into:
  ${INSTALL_DIR}

Then set HERMES_BIN in ${ENV_FILE} to the installed Hermes launcher.
MSG
  exit 1
fi

mkdir -p "$(dirname -- "${INSTALL_DIR}")"
if [[ -d "${INSTALL_DIR}/.git" ]]; then
  printf 'Hermes checkout already exists: %s\n' "${INSTALL_DIR}"
else
  git clone "${HERMES_REPO}" "${INSTALL_DIR}"
fi

git -C "${INSTALL_DIR}" fetch --tags origin
git -C "${INSTALL_DIR}" checkout "${HERMES_VERSION}"
git -C "${INSTALL_DIR}" pull --ff-only || true

cat <<MSG
Hermes source is checked out at:
  ${INSTALL_DIR}

The overlay can run this checkout through:
  ${REPO_DIR}/hermes-overlay/scripts/hermes-local.sh

To force that path, set HERMES_BIN in:
  ${ENV_FILE}
MSG

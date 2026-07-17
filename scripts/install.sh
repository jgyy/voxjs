#!/usr/bin/env bash
# Downloads/installs third-party libraries used by ft_vox.
# Per subject rules, library code itself is never committed to the repo
# (node_modules/ is gitignored) — this script fetches it on demand.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required (install Node.js >= 18) but was not found in PATH." >&2
  exit 1
fi

echo "Installing dependencies (gl-matrix, simplex-noise, vite, typescript)..."
npm install

echo "Done. Run 'npm run dev' to start the dev server."

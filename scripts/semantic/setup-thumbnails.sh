#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
python_bin="${PYTHON_BIN:-python3.11}"
venv_dir="$repo_root/tmp/semantic-thumbnails-venv"

if ! command -v "$python_bin" >/dev/null 2>&1; then
  echo "Python 3.11 is required. Set PYTHON_BIN to its executable path." >&2
  exit 1
fi

"$python_bin" -m venv "$venv_dir"
"$venv_dir/bin/python" -m pip install --upgrade pip
"$venv_dir/bin/python" -m pip install -r "$repo_root/scripts/semantic/requirements-thumbnails.txt"

"$venv_dir/bin/python" - <<'PY'
import torch

if not torch.backends.mps.is_available():
    raise SystemExit("Thumbnail runtime installed, but Apple MPS is unavailable")
print("Thumbnail runtime ready (MPS)")
PY

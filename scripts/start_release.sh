#!/bin/sh
set -eu
release_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec python3.12 "$release_root/scripts/install_release.py" --config "$release_root/release.toml" "$@"

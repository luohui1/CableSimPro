#!/bin/sh
set -eu
# No PATH lookup for Python, pip, py, Node, or a version-manager shim.
case "$0" in
  */*) release_root=$(CDPATH= cd -- "${0%/*}" && pwd) ;;
  *) release_root=$(pwd) ;;
esac
python="$release_root/runtime/python/bin/python3.12"
if [ ! -f "$python" ]; then
    printf '%s\n' 'CableSimPro: bundled Python is missing. Extract the complete release ZIP.' >&2
    exit 1
fi
chmod u+x "$python"
exec "$python" -I -B "$release_root/scripts/install_release.py" --config "$release_root/release.toml" "$@"

#!/bin/sh
# Restore the release's native library path after the plugin host intentionally
# removes inherited environment variables. No package/credential/network setup.
set -eu
release_root=$(CDPATH= cd -- "${0%/*}/.." && pwd)
if [ -d "$release_root/runtime/linux-libs" ]; then
    LD_LIBRARY_PATH="$release_root/runtime/linux-libs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    export LD_LIBRARY_PATH
fi
exec "$release_root/.venv/bin/python" "$@"

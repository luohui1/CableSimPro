"""Private database copy for frontend quick-preview regression; no native solvers."""
import argparse
import os
from pathlib import Path
import socket
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT))
parser = argparse.ArgumentParser()
parser.add_argument("directory")
parser.add_argument("--source", default=str(ROOT / ".data/release/engineering.sqlite"))
args = parser.parse_args()
directory = Path(args.directory).resolve()
if not directory.is_relative_to(ROOT / ".tmp"):
    raise ValueError("Private preview fixture must stay in .tmp")
directory.mkdir(parents=True, exist_ok=True)
database = directory / "workspace.sqlite"
with sqlite3.connect(Path(args.source).resolve().as_uri() + "?mode=ro", uri=True) as source:
    with sqlite3.connect(database) as target:
        source.backup(target)
os.environ.update(CABLESIM_DB=str(database), CABLESIM_AGENT_KEY_STORE="memory", CABLESIM_DATASETS_DIR=str(directory / "datasets"))
import uvicorn
from backend.main import app
from backend.plugin_host.resident import ResidentRunner

app.state.previews.jobs = directory / "cad-jobs"
app.state.previews.jobs.mkdir()
app.state.previews.runner = ResidentRunner(directory / "cad-workers")
server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="error"))

@app.post("/__cad_test/close")
def close():
    server.should_exit = True
    return {"closing": True}

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(f"CAD_PREVIEW_URL=http://127.0.0.1:{sock.getsockname()[1]}", flush=True)
try:
    server.run(sockets=[sock])
finally:
    sock.close()

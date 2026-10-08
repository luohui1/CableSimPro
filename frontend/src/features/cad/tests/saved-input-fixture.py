"""Read frozen case inputs from an existing saved-run DB, without opening a solver."""
import hashlib
import json
from pathlib import Path
import sqlite3
import sys

receipt = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
database = Path(receipt["database"]).resolve()
connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


try:
    replies = {}
    for kind in ("fem", "iec"):
        rid = receipt[kind + "Run"]
        row = connection.execute("SELECT input_digest,snapshot,status FROM study_runs WHERE id=?", (rid,)).fetchone()
        if not row or row[2] not in ("succeeded", "partial"):
            raise ValueError("Required saved run is missing or unsuccessful")
        digest, serialized, _status = row
        snapshot = json.loads(serialized)
        if fingerprint(snapshot) != digest:
            raise ValueError("Saved input integrity failed")
        for case in snapshot["cases"]:
            cid = case["case_id"]
            replies[f"/api/workspaces/{receipt['workspace']}/studies/{receipt[kind]}/runs/{rid}/cases/{cid}/input"] = {
                "run_id": rid, "case_id": cid, "input": case["input"],
                "input_digest": fingerprint(case["input"]), "run_input_digest": digest, "integrity": "verified",
            }
    # ASCII avoids locale-specific Windows stdout encodings while retaining exact JSON values.
    print(json.dumps(replies, ensure_ascii=True))
finally:
    connection.close()

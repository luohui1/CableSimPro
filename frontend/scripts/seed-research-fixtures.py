"""Copy saved solver evidence into an isolated UI database without altering it."""
import os
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[2]
target = Path(os.environ['CABLESIM_DB']).resolve()
scratch = (ROOT / '.tmp' / 'frontend-e2e').resolve()
if not target.is_relative_to(scratch):
    raise RuntimeError('Fixture imports require the isolated E2E database')

with sqlite3.connect(target) as destination:
    for relative, workspaces in [
        ('.data/thermal-field/cablesim.sqlite', ['91a3addc-13cd-4769-9ab7-ad97c0d57054','9d7101b2-8055-4865-bd23-f1d33e2f45c8']),
        ('.data/simulation/research-api/workspace.sqlite', ['688dbfb4-f8cb-419b-a2fc-4c1311bd5402']),
    ]:
        source_path = (ROOT / relative).resolve()
        if not source_path.is_file():
            raise RuntimeError('Saved solver evidence is missing: ' + relative)
        source = sqlite3.connect(source_path.as_uri() + '?mode=ro', uri=True)
        try:
            for wid in workspaces:
                for table, condition in [
                    ('workspaces', 'id=?'), ('workspace_history', 'workspace=?'),
                    ('workspace_revisions', 'workspace=?'), ('workspace_audit', 'workspace=?'),
                    ('studies', 'workspace=?'),
                    ('study_versions', 'study IN (SELECT id FROM studies WHERE workspace=?)'),
                    ('study_runs', 'workspace=?'),
                ]:
                    columns = [row[1] for row in source.execute('PRAGMA table_info(' + table + ')') if row[1] != 'sequence']
                    rows = source.execute('SELECT ' + ','.join(columns) + ' FROM ' + table + ' WHERE ' + condition, (wid,)).fetchall()
                    destination.executemany('INSERT INTO ' + table + '(' + ','.join(columns) + ') VALUES (' + ','.join('?' for _ in columns) + ')', rows)
        finally:
            source.close()
print('Saved thermal/native evidence copied unchanged into the temporary database.')

"""Create an isolated frontend acceptance database from existing sealed real records.

Only SQLite backup is used: no solver calls, record synthesis, or source writes.
Existing destination databases are preserved.
"""
from pathlib import Path
import argparse
import sqlite3

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, default=root / '.data/pruning/e2e.sqlite')
parser.add_argument('--destination', type=Path, default=root / '.data/frontend-integration/engineering.sqlite')
args = parser.parse_args()
source, destination = args.source.resolve(), args.destination.resolve()
if source == destination:
    raise SystemExit('源和目标数据库必须不同。')
if destination.exists():
    print(f'保留现有验收数据库：{destination}')
else:
    if not source.is_file():
        raise SystemExit(f'真实记录数据库缺失：{source}')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as original:
        with sqlite3.connect(destination) as copy:
            original.backup(copy)
    print(f'只读备份真实记录：{source} -> {destination}')

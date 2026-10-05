"""Durable, conservative Slurm CPU-time reservations shared by all local batches."""
from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3

SINGLE_LIMIT_SECONDS = 2000 * 3600
TOTAL_LIMIT_SECONDS = 20000 * 3600


class BudgetExceeded(ValueError):
    pass


def utc_now():
    return datetime.now(timezone.utc).isoformat()


class BudgetLedger:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.transaction() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS reservations(
                token TEXT PRIMARY KEY, estimate_seconds INTEGER NOT NULL,
                actual_seconds INTEGER, state TEXT NOT NULL, jobs TEXT NOT NULL,
                created TEXT NOT NULL, updated TEXT NOT NULL)''')

    @contextmanager
    def transaction(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            db.execute('PRAGMA busy_timeout=30000')
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def _charged(row):
        actual = row['actual_seconds'] or 0
        return actual if row['state'] == 'accounted' else max(row['estimate_seconds'], actual)

    def reserve(self, token, *, tasks, cpus_per_task, wall_seconds):
        if not token or any(type(v) is not int or v <= 0 for v in (tasks, cpus_per_task, wall_seconds)):
            raise ValueError('budget: token、任务数、每任务核数和时间上限必须为明确的正整数。')
        estimate = tasks * cpus_per_task * wall_seconds
        if estimate > SINGLE_LIMIT_SECONDS:
            raise BudgetExceeded('budget: 本次资源上限超过 2000 核时，须由用户另行决定。')
        with self.transaction() as db:
            existing = db.execute('SELECT * FROM reservations WHERE token=?', (token,)).fetchone()
            if existing:
                if existing['estimate_seconds'] != estimate:
                    raise ValueError('budget: 同一提交标识不能改变资源预留。')
                return dict(existing)
            charged = sum(self._charged(r) for r in db.execute('SELECT * FROM reservations'))
            if charged + estimate > TOTAL_LIMIT_SECONDS:
                raise BudgetExceeded('budget: 实际用量与未结算预留合计超过 20000 核时，须由用户另行决定。')
            now = utc_now()
            db.execute('INSERT INTO reservations VALUES(?,?,NULL,?,?,?,?)',
                       (token, estimate, 'reserved', '[]', now, now))
            return dict(db.execute('SELECT * FROM reservations WHERE token=?', (token,)).fetchone())

    def record(self, token, *, jobs, actual_seconds=None, terminal=False):
        if actual_seconds is not None and (type(actual_seconds) is not int or actual_seconds < 0):
            raise ValueError('budget.actual_seconds: 需要 sacct CPUTimeRAW 的非负整数核秒。')
        if terminal and actual_seconds is None:
            raise ValueError('budget: 尚无最终 sacct 用量，不能释放预留。')
        if len(set(jobs)) != len(jobs) or any(not str(j).isdigit() for j in jobs):
            raise ValueError('budget.jobs: 作业号必须为唯一十进制编号。')
        with self.transaction() as db:
            row = db.execute('SELECT * FROM reservations WHERE token=?', (token,)).fetchone()
            if row is None:
                raise ValueError('budget: 作业必须先预留再提交。')
            known = json.loads(row['jobs'])
            if known and known != [str(j) for j in jobs]:
                raise ValueError('budget: 已登记作业号不能被另一组覆盖。')
            if row['state'] == 'accounted' and (not terminal or actual_seconds < row['actual_seconds']):
                raise ValueError('budget: 已结算核时不可改写为较小值或重新预留；同一作业的迟到记账只能上调。')
            actual = actual_seconds if actual_seconds is not None else row['actual_seconds']
            if actual is not None and row['actual_seconds'] is not None and actual < row['actual_seconds']:
                raise ValueError('budget: 观测到的核时不能倒退。')
            db.execute('UPDATE reservations SET jobs=?,actual_seconds=?,state=?,updated=? WHERE token=?',
                       (json.dumps([str(j) for j in jobs]), actual,
                        'accounted' if terminal else 'submitted' if jobs else 'reserved', utc_now(), token))

    def summary(self):
        with self.transaction() as db:
            rows = [dict(r) for r in db.execute('SELECT * FROM reservations ORDER BY created,token')]
        return {'schema_version': 'cablesim.cpu-budget/1', 'unit': 'core_h',
                'single_limit': SINGLE_LIMIT_SECONDS / 3600, 'total_limit': TOTAL_LIMIT_SECONDS / 3600,
                'actual': sum(r['actual_seconds'] or 0 for r in rows) / 3600,
                'charged_with_reservations': sum(self._charged(r) for r in rows) / 3600,
                'reservations': [{**r, 'jobs': json.loads(r['jobs'])} for r in rows]}

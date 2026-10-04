from concurrent.futures import ThreadPoolExecutor
import pytest
from backend.kernel.batch_budget import BudgetExceeded, BudgetLedger


def test_budget_reserves_walltime_not_optimistic_runtime(tmp_path):
    ledger = BudgetLedger(tmp_path/'budget.sqlite')
    row = ledger.reserve('array', tasks=2000, cpus_per_task=1, wall_seconds=3600)
    assert row['estimate_seconds'] == 2000*3600
    with pytest.raises(BudgetExceeded, match='2000'):
        ledger.reserve('too-large', tasks=2001, cpus_per_task=1, wall_seconds=3600)
    ledger.record('array', jobs=['123'], actual_seconds=200, terminal=False)
    assert ledger.summary()['charged_with_reservations'] == 2000
    with pytest.raises(ValueError, match='sacct'):
        ledger.record('array', jobs=['123'], terminal=True)
    ledger.record('array', jobs=['123'], actual_seconds=350, terminal=True)
    assert ledger.summary()['charged_with_reservations'] == 350/3600


def test_budget_duplicate_and_concurrent_submissions_are_atomic(tmp_path):
    path = tmp_path/'budget.sqlite'
    ledger = BudgetLedger(path)
    def reserve(i):
        try:
            BudgetLedger(path).reserve(str(i), tasks=2000, cpus_per_task=1, wall_seconds=3600)
            return True
        except BudgetExceeded:
            return False
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(reserve, range(12))) == 10
    token = ledger.summary()['reservations'][0]['token']
    ledger.reserve(token, tasks=2000, cpus_per_task=1, wall_seconds=3600)
    assert ledger.summary()['charged_with_reservations'] == 20000
    with pytest.raises(ValueError, match='不能改变'):
        ledger.reserve(token, tasks=1, cpus_per_task=1, wall_seconds=1)


def test_budget_cannot_erase_or_reassign_accounting(tmp_path):
    ledger = BudgetLedger(tmp_path/'budget.sqlite')
    ledger.reserve('job', tasks=1, cpus_per_task=1, wall_seconds=60)
    ledger.record('job', jobs=['1'], actual_seconds=20)
    with pytest.raises(ValueError, match='倒退'):
        ledger.record('job', jobs=['1'], actual_seconds=10)
    with pytest.raises(ValueError, match='覆盖'):
        ledger.record('job', jobs=['2'], actual_seconds=20)
    ledger.record('job', jobs=['1'], actual_seconds=60, terminal=True)
    with pytest.raises(ValueError, match='不可改写'):
        ledger.record('job', jobs=['1'], actual_seconds=0, terminal=True)

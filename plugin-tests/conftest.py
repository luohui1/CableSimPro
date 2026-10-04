"""Native calculations are submitted to Slurm; local collection stays lightweight."""
import os
import sys
from pathlib import Path
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tests'))


def pytest_collection_modifyitems(items):
    if not os.environ.get('SLURM_JOB_ID'):
        marker=pytest.mark.skip(reason='原生仿真须在 Slurm 计算节点运行：python scripts/run_plugin_tests_hpc.py')
        for item in items:
            if 'plugin-tests' in Path(str(item.path)).parts:item.add_marker(marker)

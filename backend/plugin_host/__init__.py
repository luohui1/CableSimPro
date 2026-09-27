"""Plugin host for cablesim.plugin/2 minimal protocol (architecture D3)."""
from .executor import CaseResult, Executor, RunResult
from .registry import PluginHostError, Registry

__all__ = ['CaseResult', 'Executor', 'PluginHostError', 'Registry', 'RunResult']

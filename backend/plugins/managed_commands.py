"""Host-owned command routing, never entry-point paths from a manifest.

Adding an independent adapter does not reseal unrelated published payloads.
The old worker and its declared source files retain their exact versions.
"""
from .arguments import ARGUMENTS
from .electrothermal_contract import ElectrothermalArgs

COMMAND_ARGUMENTS = {**ARGUMENTS, 'skfem.electrothermal-reference': ElectrothermalArgs}
WORKER_ENTRIES = {'skfem.electrothermal-reference': 'backend/plugins/electrothermal_worker.py'}

"""Host-owned command routing, never entry-point paths from a manifest.

Adding an independent adapter does not reseal unrelated published payloads.
The old worker and its declared source files retain their exact versions.
"""
from .arguments import ARGUMENTS
from .electrothermal_contract import ElectrothermalArgs
from .line_source_contract import LineSourceArgs

COMMAND_ARGUMENTS = {**ARGUMENTS,
    'skfem.electrothermal-reference': ElectrothermalArgs,
    'validation.line-source-buried': LineSourceArgs}
WORKER_ENTRIES = {
    'skfem.electrothermal-reference': 'backend/plugins/electrothermal_worker.py',
    'validation.line-source-buried': 'backend/plugins/line_source_worker.py'}

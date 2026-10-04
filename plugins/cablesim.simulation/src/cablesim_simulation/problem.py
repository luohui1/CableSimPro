"""Compatibility import for the shared solver-neutral SI analysis contract."""
from backend.foundation.simulation import (
    Material, Shape, Condition, Excitation, Time, CurrentProbe, Problem, MeshControls, validate,
)

__all__ = ["Material", "Shape", "Condition", "Excitation", "Time", "CurrentProbe", "Problem", "MeshControls", "validate"]

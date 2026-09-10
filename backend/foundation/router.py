"""Revision-bound GET endpoints for the additive, non-solving study foundation."""
from typing import Literal
from fastapi import APIRouter, Query
from .study import PreflightReport, prepare_study


def make_router(store) -> APIRouter:
    router = APIRouter(prefix="/api/foundation", tags=["Study preparation (read-only)"])

    @router.get("/capabilities")
    def capabilities():
        return {
            "schema_version": "csp-study/0.1", "scope": "preflight_only",
            "asset_kinds": ["material", "component", "assembly", "installation", "study_template", "rule"],
            "native_adapters": {"comsol": "not_configured", "aedt": "not_configured"},
            "writes_workspace": False, "executes_solver": False,
        }

    @router.get("/workspaces/{wid}/preflight", response_model=PreflightReport)
    def preflight(wid: str, expected_revision: int = Query(ge=1),
                  target: Literal["schema", "comsol", "aedt"] = "schema"):
        # A single read transaction gives revision, state, and provenance one boundary.
        with store.db() as db:
            db.execute("BEGIN")
            row, state = store.load(db, wid, expected_revision)
            snapshot = {"id": wid, "revision": row["revision"], **state}
        return prepare_study(snapshot, target)

    return router

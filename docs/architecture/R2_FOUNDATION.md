# R2 engineering foundation — first implementation slice

## Boundaries

This additive slice introduces immutable quantity / asset / circular-recipe contracts and a revision-bound, read-only study-preparation endpoint. It does **not** introduce a new numerical solver, an asset publishing service, a B-Rep builder, a COMSOL/AEDT integration, or a production authentication layer.

`backend/foundation/contracts.py` owns the schema primitives: explicit SI conversion, absolute-temperature versus temperature-difference handling, exact asset references and bounded dependency closure, isolated payload-byte verification, instance overrides, and continuous circular-layer recipes. Published content identity is separate from lifecycle policy; the latter remains a subsequent service.

`backend/foundation/study.py` projects the committed workspace into a `csp-study/0.1` design package. It preserves source kind and content hash, does not pretend project inputs are reviewed asset releases, and does not substitute a missing manufacturer R20. The 1 m recipe length is a local section-construction length, not the route length. UID mapping refers to the existing six-layer single-core model only.

## Read-only interface

- `GET /api/foundation/capabilities`
- `GET /api/foundation/workspaces/{id}/preflight?expected_revision=N&target=schema|comsol|aedt`

The endpoint uses one read transaction and the existing workspace revision guard. It creates no audit entries, jobs, proposals, results, or assets. `package_ready` means schema preparation succeeded, not native geometry or simulation. Native targets return a blocking issue until a real adapter is configured. Native software is never launched by this slice.

The command center exposes **研究准备与求解器预检** on demand. There is no extra permanent toolbar, result card, or drawer. The dialog masks obsolete responses, aborts requests when dismissed, blocks dirty/busy workspace input, and exports the exact displayed preflight evidence. It never submits a write request.

## Validation

Unit tests use independent arithmetic and negative fixtures. Application tests check actual `create_app` registration, version conflict, missing project, host boundary and persistence invariance. The focused Playwright lane checks real API evidence, no POST/write, matching JSON export, native-unavailable status, draft blocking, and dialog accessibility. Existing solver and full-browser tests are unchanged; their prior passing results are not reused as this commit's evidence.

The editor environment has no package-network resolution and lacks langgraph/frontend node_modules. Locally executed evidence therefore covers foundation contract/study tests only. The `Engineering foundation review` workflow performs installed-dependency API tests, the actual TypeScript/Vite build, command contracts, and real-browser tests for the exact pushed source. It must be inspected before claiming integration acceptance.

## Next dependent slices

1. Reviewed asset persistence and permission-scoped publishing, without automatic project upgrades.
2. Parameterized geometry worker and semantic-selection rebinding (B-Rep separate from GLB).
3. COMSOL build-only adapter in a licensed environment, with a real BuildManifest and no study execution.
4. Scenario/route/circuit model expansion and three-state PC study workspace. Do not infer numerical support from a displayed asset kind.

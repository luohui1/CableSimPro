// Generated from the formal host OpenAPI. Do not edit.
export const endpoints = {
  "/api/workspaces": [
    "get",
    "post"
  ],
  "/api/workspaces/{wid}": [
    "get"
  ],
  "/api/workspaces/{wid}/session": [
    "get"
  ],
  "/api/workspaces/{wid}/edit": [
    "post"
  ],
  "/api/workspaces/{wid}/lock": [
    "post"
  ],
  "/api/workspaces/{wid}/history/{direction}": [
    "post"
  ],
  "/api/workspaces/{wid}/runs/{rid}": [
    "get"
  ],
  "/api/foundation/capabilities": [
    "get"
  ],
  "/api/foundation/workspaces/{wid}/preflight": [
    "get"
  ],
  "/api/foundation/assets": [
    "get"
  ],
  "/api/foundation/assets/import": [
    "post"
  ],
  "/api/foundation/assets/{rid}": [
    "get",
    "put"
  ],
  "/api/foundation/assets/{rid}/transition": [
    "post"
  ],
  "/api/foundation/assets/{rid}/derive": [
    "post"
  ],
  "/api/foundation/workspaces/{wid}/assets/capture": [
    "post"
  ],
  "/api/foundation/reproductions": [
    "get"
  ],
  "/api/foundation/reproductions/{target_id}": [
    "get"
  ],
  "/api/foundation/reproductions/{target_id}/export": [
    "get"
  ],
  "/api/methods": [
    "get"
  ],
  "/api/plugins/{plugin_id}/assets/{role}": [
    "get"
  ],
  "/api/study-tasks": [
    "get"
  ],
  "/api/model-artifacts": [
    "get"
  ],
  "/api/measurement-input-contract": [
    "get"
  ],
  "/api/workspaces/{wid}/revisions": [
    "get"
  ],
  "/api/workspaces/{wid}/revisions/{revision}": [
    "get"
  ],
  "/api/workspaces/{wid}/studies": [
    "get",
    "post"
  ],
  "/api/studies/{sid}": [
    "get"
  ],
  "/api/workspaces/{wid}/studies/{sid}": [
    "get",
    "put"
  ],
  "/api/workspaces/{wid}/studies/{sid}/recalculate": [
    "post"
  ],
  "/api/workspaces/{wid}/studies/{sid}/preview": [
    "post"
  ],
  "/api/workspaces/{wid}/studies/{sid}/upgrade-methods": [
    "post"
  ],
  "/api/workspaces/{wid}/studies/{sid}/undo": [
    "post"
  ],
  "/api/workspaces/{wid}/studies/{sid}/redo": [
    "post"
  ],
  "/api/workspaces/{wid}/studies/{sid}/preflight": [
    "get"
  ],
  "/api/workspaces/{wid}/studies/{sid}/runs": [
    "post",
    "get"
  ],
  "/api/workspaces/{wid}/studies/{sid}/runs/{rid}": [
    "get"
  ],
  "/api/workspaces/{wid}/studies/{sid}/runs/{rid}/cases/{case_id}/input": [
    "get"
  ],
  "/api/workspaces/{wid}/studies/{sid}/runs/{rid}/resume": [
    "post"
  ],
  "/api/workspaces/{wid}/study-comparisons": [
    "post"
  ],
  "/api/workspaces/{wid}/deliveries": [
    "post",
    "get"
  ],
  "/api/workspaces/{wid}/deliveries/{did}": [
    "get"
  ],
  "/api/database/version": [
    "get"
  ],
  "/api/database/backups": [
    "get",
    "post"
  ],
  "/api/database/backups/{identifier}/file": [
    "get"
  ],
  "/api/database/restores": [
    "post"
  ],
  "/api/database/restores/current": [
    "get",
    "delete"
  ],
  "/api/workspaces/{wid}/delivery-jobs": [
    "post"
  ],
  "/api/workspaces/{wid}/delivery-jobs/{jid}": [
    "get"
  ],
  "/api/workspaces/{wid}/delivery-jobs/{jid}/cancel": [
    "post"
  ],
  "/api/workspaces/{wid}/runs/{rid}/fem-conclusion": [
    "get"
  ],
  "/api/simulation/problem-contract": [
    "get"
  ],
  "/api/workspaces/{wid}/geometry-preview": [
    "post"
  ],
  "/api/design/workspaces/{wid}/geometry-preview": [
    "post"
  ],
  "/api/input-contracts": [
    "get"
  ],
  "/api/design/input-contracts": [
    "get"
  ],
  "/api/examples/iec": [
    "get"
  ],
  "/api/design/examples/iec": [
    "get"
  ],
  "/api/examples/cable": [
    "get"
  ],
  "/api/design/examples/cable": [
    "get"
  ],
  "/api/workspaces/{wid}/deliveries/current": [
    "post"
  ],
  "/api/design/workspaces/{wid}/deliveries": [
    "post"
  ],
  "/api/workspaces/{wid}/deliveries/{did}/pdf": [
    "get"
  ],
  "/api/workspaces/{wid}/deliveries/{did}/file": [
    "get"
  ],
  "/api/design/workspaces/{wid}/deliveries/{did}/file": [
    "get"
  ],
  "/api/plugin-queries/{plugin_id}/{capability_id}": [
    "post"
  ],
  "/api/workspaces/{wid}/studies/{sid}/batch-configuration": [
    "get",
    "put"
  ],
  "/api/workspaces/{wid}/studies/{sid}/batch-preflight": [
    "post"
  ],
  "/api/workspaces/{wid}/studies/{sid}/datasets": [
    "post",
    "get"
  ],
  "/api/workspaces/{wid}/studies/{sid}/datasets/{batch_id}": [
    "get"
  ],
  "/api/workspaces/{wid}/studies/{sid}/datasets/{batch_id}/resume": [
    "post"
  ],
  "/api/workspaces/{wid}/studies/{sid}/datasets/{batch_id}/export": [
    "post"
  ],
  "/api/workspaces/{wid}/studies/{sid}/runs/{rid}/progress": [
    "get"
  ],
  "/api/workspaces/{wid}/studies/{sid}/runs/{rid}/cancel": [
    "post"
  ],
  "/api/hpc/profile": [
    "get",
    "put"
  ],
  "/api/hpc/heat-capacity/preflight": [
    "post"
  ],
  "/api/hpc/profile/configuration": [
    "get"
  ],
  "/api/hpc/profile/undo": [
    "post"
  ],
  "/api/hpc/profile/check": [
    "post"
  ],
  "/api/hpc/workspaces/{wid}/studies/{sid}/input-preflight": [
    "get"
  ],
  "/api/hpc/workspaces/{wid}/studies/{sid}/step-responses": [
    "get",
    "post"
  ],
  "/api/hpc/workspaces/{wid}/studies/{sid}/step-responses/estimate": [
    "post"
  ],
  "/api/hpc/workspaces/{wid}/studies/{sid}/step-responses/source-check": [
    "get"
  ],
  "/api/hpc/step-responses/{identifier}": [
    "get"
  ],
  "/api/hpc/step-responses/{identifier}/cancel": [
    "post"
  ],
  "/api/hpc/step-responses/{identifier}/resume": [
    "post"
  ],
  "/api/hpc/jobs": [
    "get"
  ],
  "/api/hpc/jobs/{identifier}": [
    "get"
  ],
  "/api/hpc/jobs/{identifier}/cancel": [
    "post"
  ],
  "/api/hpc/jobs/{identifier}/refresh": [
    "post"
  ],
  "/api/hpc/convergence": [
    "get"
  ],
  "/api/hpc/workspaces/{wid}/studies/{sid}/estimate": [
    "get"
  ],
  "/api/hpc/workspaces/{wid}/studies/{sid}/availability": [
    "get"
  ],
  "/api/hpc/workspaces/{wid}/studies/{sid}/convergence": [
    "post"
  ],
  "/api/hpc/convergence/{identifier}": [
    "get"
  ],
  "/api/hpc/convergence/{identifier}/cancel": [
    "post"
  ],
  "/api/hpc/convergence/{identifier}/resume": [
    "post"
  ],
  "/api/hpc/workspaces/{wid}/chapters/{rid}": [
    "get"
  ],
  "/api/hpc/workspaces/{wid}/fields/{rid}.png": [
    "get"
  ],
  "/api/hpc/workspaces/{wid}/fields/{rid}/view": [
    "get"
  ],
  "/api/hpc/workspaces/{wid}/fields/{rid}/full": [
    "get"
  ],
  "/api/hpc/workspaces/{wid}/fields/{rid}/sample": [
    "post"
  ],
  "/api/domain-cable-models": [
    "get",
    "post"
  ],
  "/api/domain-cable-models/{cid}": [
    "delete"
  ],
  "/api/documents": [
    "get",
    "post"
  ],
  "/api/documents/{did}": [
    "get"
  ],
  "/api/documents/{did}/file": [
    "get"
  ],
  "/api/documents/{did}/pages/{page}": [
    "get"
  ],
  "/api/documents/{did}/pages/{page}/image": [
    "get"
  ],
  "/api/documents/{did}/disclosures": [
    "post"
  ],
  "/api/documents/{did}/extractions": [
    "post",
    "get"
  ],
  "/api/documents/{did}/extractions/{eid}": [
    "get"
  ],
  "/api/documents/{did}/extractions/{eid}/reviews": [
    "post"
  ],
  "/api/documents/{did}/proposals": [
    "post"
  ],
  "/api/documents/{did}/comparisons": [
    "post"
  ],
  "/api/documents/{did}/proposals/{pid}": [
    "get"
  ],
  "/api/documents/{did}/proposals/{pid}/approval": [
    "post"
  ],
  "/api/documents/{did}/batches": [
    "post"
  ],
  "/api/documents/{did}/batches/{bid}": [
    "get"
  ],
  "/api/documents/{did}/batches/{bid}/approval": [
    "post"
  ],
  "/api/workspaces/{wid}/domain": [
    "get",
    "put"
  ],
  "/api/workspaces/{wid}/domain/conversion": [
    "get",
    "post"
  ],
  "/api/types/{wid}/release-scope": [
    "post"
  ],
  "/api/types/{wid}/short-circuit-basis": [
    "post"
  ],
  "/api/types/creation-options": [
    "get"
  ],
  "/api/types/creation-proposals": [
    "post"
  ],
  "/api/types": [
    "post"
  ],
  "/api/types/{wid}/document": [
    "put"
  ],
  "/api/types/library": [
    "get"
  ],
  "/api/types/{wid}/comparison": [
    "get"
  ],
  "/api/types/{wid}/resources": [
    "get"
  ],
  "/api/types/{wid}/workspace": [
    "get"
  ],
  "/api/types/{wid}/resources/bind": [
    "post"
  ],
  "/api/types/{wid}/resources/material-preview": [
    "post"
  ],
  "/api/types/{wid}/resources/material-confirm": [
    "post"
  ],
  "/api/types/{wid}/resources/migrate": [
    "post"
  ],
  "/api/types/{wid}/material-comparison": [
    "get"
  ],
  "/api/types/{wid}/material-comparison/adopt": [
    "post"
  ],
  "/api/types/{wid}/plans": [
    "post"
  ],
  "/api/types/{wid}/adopt": [
    "post"
  ],
  "/api/types/{wid}/specification": [
    "get"
  ],
  "/api/types/{wid}/specification/generate": [
    "post"
  ],
  "/api/types/{wid}/specification/file": [
    "get"
  ],
  "/api/types/{wid}/measurements": [
    "post"
  ],
  "/api/types/{wid}/standards-summary": [
    "get"
  ],
  "/api/types/{wid}/display-runs": [
    "get"
  ],
  "/api/types/{wid}/measurements/reports/{report_id}": [
    "get"
  ],
  "/api/types/{wid}/submissions": [
    "post"
  ],
  "/api/types/{wid}/approve": [
    "post"
  ],
  "/api/types/{wid}/publish": [
    "post"
  ],
  "/api/design/cable-models": [
    "get"
  ],
  "/api/design/study-cable-models": [
    "get"
  ],
  "/api/design/engineering-examples": [
    "get"
  ],
  "/api/design/type-workspaces": [
    "get",
    "post"
  ],
  "/api/design/workspaces/{wid}/section-template": [
    "post"
  ],
  "/api/design/study-workspaces": [
    "post"
  ],
  "/api/design/workspaces/{wid}/cable-reference": [
    "post"
  ],
  "/api/design/type-workspaces/{wid}/requirements": [
    "get"
  ],
  "/api/design/type-workspaces/{wid}/requirements/basis": [
    "post"
  ],
  "/api/design/type-workspaces/{wid}/requirements/reviews": [
    "post"
  ],
  "/api/design/workspaces/{wid}/rating-table-definition": [
    "post"
  ],
  "/api/design/workspaces/{wid}/rating-table-runs/{rid}": [
    "get"
  ],
  "/api/agent/capabilities": [
    "get"
  ],
  "/api/agent/status": [
    "get"
  ],
  "/api/agent/settings": [
    "get",
    "put",
    "delete"
  ],
  "/api/agent/settings/test": [
    "post"
  ],
  "/api/agent/memory/settings": [
    "get",
    "put"
  ],
  "/api/agent/memories": [
    "get"
  ],
  "/api/agent/memories/{id}": [
    "put",
    "delete"
  ],
  "/api/agent/sessions/{id}/memory": [
    "get",
    "post"
  ],
  "/api/agent/tools": [
    "get"
  ],
  "/api/agent/recipes": [
    "get"
  ],
  "/api/agent/sessions": [
    "post",
    "get"
  ],
  "/api/agent/sessions/{id}": [
    "get"
  ],
  "/api/agent/sessions/{id}/messages": [
    "post"
  ],
  "/api/agent/proposals/{id}/approve": [
    "post"
  ],
  "/api/agent/proposals/{id}/reject": [
    "post"
  ],
  "/api/agent/sessions/{id}/reconcile": [
    "post"
  ],
  "/api/agent/contract": [
    "get"
  ],
  "/api/index/objects": [
    "get"
  ],
  "/api/index/objects/{kind}/{id}/relations": [
    "get"
  ],
  "/api/index/inbox": [
    "get"
  ],
  "/api/health": [
    "get"
  ],
  "/api/presets": [
    "get"
  ],
  "/": [
    "get"
  ]
} as const;

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
  "/api/workspaces/{wid}/studies/{sid}": [
    "put"
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
  "/api/workspaces/{wid}/studies/{sid}/runs/{rid}/resume": [
    "post"
  ],
  "/api/workspaces/{wid}/study-comparisons": [
    "post"
  ],
  "/api/workspaces/{wid}/deliveries": [
    "post"
  ],
  "/api/workspaces/{wid}/deliveries/{did}": [
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
  "/api/workspaces/{wid}/deliveries/{did}/file": [
    "get"
  ],
  "/api/design/workspaces/{wid}/deliveries/{did}/file": [
    "get"
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
  "/api/workspaces/{wid}/domain": [
    "get",
    "put"
  ],
  "/api/workspaces/{wid}/domain/conversion": [
    "get",
    "post"
  ],
  "/api/types/library": [
    "get"
  ],
  "/api/types/{wid}/comparison": [
    "get"
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
  "/api/types/{wid}/specification/file": [
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
  "/api/design/type-workspaces/{wid}/requirements/reviews": [
    "post"
  ],
  "/api/design/workspaces/{wid}/rating-table-definition": [
    "post"
  ],
  "/api/design/workspaces/{wid}/rating-table-runs/{rid}": [
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

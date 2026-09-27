# R2.1 — local engineering asset library

## Status

The backend contract below is implemented and tested (`tests/foundation/test_assets.py`,
`test_asset_router.py`). The asset library UI was retired with the old shells (architecture
D1, PRD §4.4) and is paused; `WorkflowApp` does not expose it yet. When it returns it must
reuse the workflow shell's controls rather than a separate collection page.

An asset section preview is generated from saved layer radii, not an image file,
thermal result, B-Rep or manufacturer rendering.

## Domain and persistence

`AssetRelease` now optionally contains a single-core circular geometry recipe,
which participates in its content digest. The six taxonomy kinds are **definition
categories**, not declarations that numerical methods or geometry builders exist
for all those classes. The current capture lane saves structure and a parameter
summary only: it does not copy installation, constitutive materials or results.

`engineering_assets` stores exact asset ID/version, local record revision, immutable
release content/digest, status and review digest. `engineering_asset_events` stores
one local event per record revision. Both update atomically under BEGIN IMMEDIATE.
The local operator is the sole authority in this preview: there is no fabricated
user identity, independent-review claim or enterprise RBAC certification.

Lifecycle:
- Import/capture -> draft. Reads never publish or apply definitions.
- Draft -> reviewed requires an explicit source acknowledgement and a note.
- Reviewed -> published requires matching record revision, reviewed content digest,
  and currently published, digest-matching transitive dependencies.
- Reviewed -> draft clears its review digest before editing.
- Published -> deprecated preserves content and blocks new dependent publication.
- Published/deprecated -> derived version creates a new draft, keeping the old one.

Imported `SourceReference.reviewed` is not promoted automatically. Local review
records acknowledge inspection but do not change the origin's evidence quality.
No lifecycle action mutates a workspace, its history, runs, locks or proposals.
Capture binds asset creation to the workspace revision in the same DB transaction.

## Interfaces

| Method | Path suffix under `/api/foundation` | Contract |
|---|---|---|
| GET | `/assets` | bounded search/category/status filtering and pagination |
| GET | `/assets/{id}` | exact definition, pending issues and 100 latest local events |
| POST | `/assets/import` | `csp-asset/0.1` envelope; all inputs become drafts |
| POST | `/workspaces/{id}/assets/capture` | expected workspace revision + asset name |
| PUT | `/assets/{id}` | expected asset revision + full draft definition |
| POST | `/assets/{id}/transition` | expected revision + content SHA + explicit action/note |
| POST | `/assets/{id}/derive` | expected revision + content SHA + new exact version |

JSON definitions only. Nonempty file manifests are rejected until isolated payload
verification/storage is implemented. This is not archive ingestion, a CAD importer,
or script execution. Instance-to-project application and project asset-lock binding
remain subsequent slices; merely publishing a definition never changes a study.

## Test evidence

Backend tests cover immutable releases, source trust preservation, stale review, atomic CAS,
concurrent reviewers, changed/deprecated transitive dependencies, corrupt content,
JSON version conflicts, unsafe payload declarations, project immutability, capture,
export and derive. There is currently no browser test because there is no UI.

## Next boundaries

Geometry workers, material laws, manufacturing product catalogues, arbitrary payload
storage, project asset application, COMSOL/AEDT native build and numerical validation
are not implemented by this slice. Keep those capabilities disabled until their
own data and execution contracts are validated.

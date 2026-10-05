// Generated from the formal host OpenAPI. Run npm run generate:api; do not edit.
export interface paths {
    "/api/workspaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Listing */
        get: operations["listing_api_workspaces_get"];
        put?: never;
        /** Create */
        post: operations["create_api_workspaces_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get */
        get: operations["get_api_workspaces__wid__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Restore Session
         * @description Read-only, transaction-consistent projection for both interaction modes.
         *
         *     Reopening is not approval, execution, or a change of engineering revision.
         *     Expired/stale proposals remain inspectable but cannot be approved.
         */
        get: operations["restore_session_api_workspaces__wid__session_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/edit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Edit */
        post: operations["edit_api_workspaces__wid__edit_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/lock": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Lock */
        post: operations["lock_api_workspaces__wid__lock_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/history/{direction}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** History */
        post: operations["history_api_workspaces__wid__history__direction__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/runs/{rid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Run */
        get: operations["get_run_api_workspaces__wid__runs__rid__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/foundation/capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Capabilities */
        get: operations["capabilities_api_foundation_capabilities_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/foundation/workspaces/{wid}/preflight": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Preflight */
        get: operations["preflight_api_foundation_workspaces__wid__preflight_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/foundation/assets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Assets */
        get: operations["list_assets_api_foundation_assets_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/foundation/assets/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Import Asset */
        post: operations["import_asset_api_foundation_assets_import_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/foundation/assets/{rid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Asset Detail */
        get: operations["asset_detail_api_foundation_assets__rid__get"];
        /** Edit Asset */
        put: operations["edit_asset_api_foundation_assets__rid__put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/foundation/assets/{rid}/transition": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Transition Asset */
        post: operations["transition_asset_api_foundation_assets__rid__transition_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/foundation/assets/{rid}/derive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Derive Asset */
        post: operations["derive_asset_api_foundation_assets__rid__derive_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/foundation/workspaces/{wid}/assets/capture": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Capture Asset */
        post: operations["capture_asset_api_foundation_workspaces__wid__assets_capture_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/foundation/reproductions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Catalog */
        get: operations["catalog_api_foundation_reproductions_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/foundation/reproductions/{target_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Detail */
        get: operations["detail_api_foundation_reproductions__target_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/foundation/reproductions/{target_id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Export */
        get: operations["export_api_foundation_reproductions__target_id__export_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/methods": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Methods */
        get: operations["methods_api_methods_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/study-tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Tasks */
        get: operations["tasks_api_study_tasks_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/model-artifacts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Model Artifacts */
        get: operations["model_artifacts_api_model_artifacts_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/measurement-input-contract": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Measurement Input Contract */
        get: operations["measurement_input_contract_api_measurement_input_contract_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/revisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Revisions */
        get: operations["revisions_api_workspaces__wid__revisions_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/revisions/{revision}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Revision */
        get: operations["revision_api_workspaces__wid__revisions__revision__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Studies */
        get: operations["studies_api_workspaces__wid__studies_get"];
        put?: never;
        /** Create */
        post: operations["create_api_workspaces__wid__studies_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies/{sid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Update */
        put: operations["update_api_workspaces__wid__studies__sid__put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies/{sid}/preflight": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Preflight */
        get: operations["preflight_api_workspaces__wid__studies__sid__preflight_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies/{sid}/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Runs */
        get: operations["runs_api_workspaces__wid__studies__sid__runs_get"];
        put?: never;
        /** Execute */
        post: operations["execute_api_workspaces__wid__studies__sid__runs_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies/{sid}/runs/{rid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Run */
        get: operations["run_api_workspaces__wid__studies__sid__runs__rid__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies/{sid}/runs/{rid}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resume */
        post: operations["resume_api_workspaces__wid__studies__sid__runs__rid__resume_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/study-comparisons": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Comparison */
        post: operations["comparison_api_workspaces__wid__study_comparisons_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Deliver */
        post: operations["deliver_api_workspaces__wid__deliveries_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/deliveries/{did}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Delivery */
        get: operations["delivery_api_workspaces__wid__deliveries__did__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/geometry-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Geometry Preview */
        post: operations["geometry_preview_api_workspaces__wid__geometry_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/design/workspaces/{wid}/geometry-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Geometry Preview
         * @deprecated
         */
        post: operations["geometry_preview_api_design_workspaces__wid__geometry_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/input-contracts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Input Contracts */
        get: operations["input_contracts_api_input_contracts_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/design/input-contracts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Input Contracts
         * @deprecated
         */
        get: operations["input_contracts_api_design_input_contracts_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/examples/iec": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Iec Example */
        get: operations["iec_example_api_examples_iec_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/design/examples/iec": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Iec Example
         * @deprecated
         */
        get: operations["iec_example_api_design_examples_iec_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/examples/cable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Cable Example */
        get: operations["cable_example_api_examples_cable_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/design/examples/cable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Cable Example
         * @deprecated
         */
        get: operations["cable_example_api_design_examples_cable_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/deliveries/current": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Current Delivery */
        post: operations["current_delivery_api_workspaces__wid__deliveries_current_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/design/workspaces/{wid}/deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Current Delivery
         * @deprecated
         */
        post: operations["current_delivery_api_design_workspaces__wid__deliveries_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/deliveries/{did}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Delivery File */
        get: operations["delivery_file_api_workspaces__wid__deliveries__did__file_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/design/workspaces/{wid}/deliveries/{did}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Delivery File
         * @deprecated
         */
        get: operations["delivery_file_api_design_workspaces__wid__deliveries__did__file_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies/{sid}/batch-configuration": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Configuration */
        get: operations["configuration_api_workspaces__wid__studies__sid__batch_configuration_get"];
        /** Save */
        put: operations["save_api_workspaces__wid__studies__sid__batch_configuration_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies/{sid}/batch-preflight": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preflight */
        post: operations["preflight_api_workspaces__wid__studies__sid__batch_preflight_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies/{sid}/datasets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Listing */
        get: operations["listing_api_workspaces__wid__studies__sid__datasets_get"];
        put?: never;
        /** Submit */
        post: operations["submit_api_workspaces__wid__studies__sid__datasets_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies/{sid}/datasets/{batch_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get */
        get: operations["get_api_workspaces__wid__studies__sid__datasets__batch_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies/{sid}/datasets/{batch_id}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resume */
        post: operations["resume_api_workspaces__wid__studies__sid__datasets__batch_id__resume_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies/{sid}/datasets/{batch_id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Export */
        post: operations["export_api_workspaces__wid__studies__sid__datasets__batch_id__export_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/domain-cable-models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Catalogue */
        get: operations["catalogue_api_domain_cable_models_get"];
        put?: never;
        /** Create */
        post: operations["create_api_domain_cable_models_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/domain-cable-models/{cid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Discard
         * @description Discard only an unused draft with an exact content acknowledgement.
         */
        delete: operations["discard_api_domain_cable_models__cid__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Catalogue */
        get: operations["catalogue_api_documents_get"];
        put?: never;
        /** Upload */
        post: operations["upload_api_documents_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/documents/{did}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Detail */
        get: operations["detail_api_documents__did__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/documents/{did}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Original */
        get: operations["original_api_documents__did__file_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/documents/{did}/pages/{page}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Page */
        get: operations["page_api_documents__did__pages__page__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/documents/{did}/pages/{page}/image": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Image */
        get: operations["image_api_documents__did__pages__page__image_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/documents/{did}/disclosures": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disclose */
        post: operations["disclose_api_documents__did__disclosures_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/documents/{did}/extractions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** History */
        get: operations["history_api_documents__did__extractions_get"];
        put?: never;
        /** Extract */
        post: operations["extract_api_documents__did__extractions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/documents/{did}/extractions/{eid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Extraction */
        get: operations["extraction_api_documents__did__extractions__eid__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/documents/{did}/extractions/{eid}/reviews": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Review */
        post: operations["review_api_documents__did__extractions__eid__reviews_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/documents/{did}/proposals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Propose */
        post: operations["propose_api_documents__did__proposals_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/documents/{did}/comparisons": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Compare */
        post: operations["compare_api_documents__did__comparisons_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/documents/{did}/proposals/{pid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Proposal */
        get: operations["proposal_api_documents__did__proposals__pid__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/documents/{did}/proposals/{pid}/approval": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve */
        post: operations["approve_api_documents__did__proposals__pid__approval_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/domain": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get */
        get: operations["get_api_workspaces__wid__domain_get"];
        /** Save */
        put: operations["save_api_workspaces__wid__domain_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/domain/conversion": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Preview */
        get: operations["preview_api_workspaces__wid__domain_conversion_get"];
        put?: never;
        /** Migrate */
        post: operations["migrate_api_workspaces__wid__domain_conversion_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/library": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Library */
        get: operations["library_api_types_library_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/comparison": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Comparison */
        get: operations["comparison_api_types__wid__comparison_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Branch */
        post: operations["branch_api_types__wid__plans_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/adopt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Adopt */
        post: operations["adopt_api_types__wid__adopt_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/specification": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Specification */
        get: operations["specification_api_types__wid__specification_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/specification/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Specification File */
        get: operations["specification_file_api_types__wid__specification_file_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/submissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Submit */
        post: operations["submit_api_types__wid__submissions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve */
        post: operations["approve_api_types__wid__approve_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Publish */
        post: operations["publish_api_types__wid__publish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/design/cable-models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Models */
        get: operations["models_api_design_cable_models_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/design/study-cable-models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Study Catalog */
        get: operations["study_catalog_api_design_study_cable_models_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/design/engineering-examples": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Examples */
        get: operations["examples_api_design_engineering_examples_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/design/type-workspaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Types */
        get: operations["types_api_design_type_workspaces_get"];
        put?: never;
        /** Create Type */
        post: operations["create_type_api_design_type_workspaces_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/design/workspaces/{wid}/section-template": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Layout */
        post: operations["layout_api_design_workspaces__wid__section_template_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/design/study-workspaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create */
        post: operations["create_api_design_study_workspaces_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/design/workspaces/{wid}/cable-reference": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Bind */
        post: operations["bind_api_design_workspaces__wid__cable_reference_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/design/type-workspaces/{wid}/requirements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read */
        get: operations["read_api_design_type_workspaces__wid__requirements_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/design/type-workspaces/{wid}/requirements/reviews": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Review */
        post: operations["review_api_design_type_workspaces__wid__requirements_reviews_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/design/workspaces/{wid}/rating-table-definition": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Definition */
        post: operations["definition_api_design_workspaces__wid__rating_table_definition_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/design/workspaces/{wid}/rating-table-runs/{rid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Results */
        get: operations["results_api_design_workspaces__wid__rating_table_runs__rid__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health */
        get: operations["health_api_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/presets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Presets */
        get: operations["get_presets_api_presets_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Home */
        get: operations["home__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** Adopt */
        Adopt: {
            /** Expected Revision */
            expected_revision: number;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
        };
        /** AirHeatCapacity */
        AirHeatCapacity: {
            /**
             * Heat Capacity J M3 K
             * @description Equivalent air volumetric heat capacity J/(m³*K).
             */
            heat_capacity_j_m3_k: number;
            /**
             * Source
             * @description Engineering or published source for this capacity.
             */
            source: string;
        };
        /** ApiError */
        ApiError: {
            /**
             * Detail
             * @description Coded business failure, or field validation issues with loc/msg/type.
             */
            detail: components["schemas"]["ApiErrorDetail"] | {
                [key: string]: components["schemas"]["JsonValue"];
            }[];
        };
        /** ApiErrorDetail */
        ApiErrorDetail: {
            /**
             * Code
             * @description Stable machine-readable error code.
             */
            code: string;
            /**
             * Message
             * @description Actionable correction or failure description.
             */
            message: string;
        };
        /** Approval */
        Approval: {
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Submission Id
             * Format: uuid
             */
            submission_id: string;
            /** Specification Digest */
            specification_digest: string;
            /**
             * Human Confirmed
             * @constant
             */
            human_confirmed: true;
        };
        /** ApprovalRequest */
        ApprovalRequest: {
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Proposal Sha256
             * @description Exact proposal contents acknowledged by the human.
             */
            proposal_sha256: string;
            /** Approver */
            approver: string;
            /**
             * Human Approved
             * @description Explicit human approval; extraction plugin never calls this endpoint.
             * @constant
             */
            human_approved: true;
        };
        /** AssetParameter */
        AssetParameter: {
            /** Name */
            name: string;
            quantity: components["schemas"]["Quantity"];
            /**
             * Overridable
             * @default false
             */
            overridable?: boolean;
        };
        /** AssetRef */
        AssetRef: {
            /** Asset Id */
            asset_id: string;
            /** Version */
            version: string;
            /** Content Sha256 */
            content_sha256: string;
        };
        /** AssetRelease */
        AssetRelease: {
            /** Asset Id */
            asset_id: string;
            /** Version */
            version: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "material" | "component" | "assembly" | "installation" | "study_template" | "rule";
            /** Name */
            name: string;
            /**
             * Parameters
             * @default []
             */
            parameters?: components["schemas"]["AssetParameter"][];
            /**
             * Dependencies
             * @default []
             */
            dependencies?: components["schemas"]["AssetRef"][];
            /**
             * Files
             * @default []
             */
            files?: components["schemas"]["PayloadFile"][];
            /** Sources */
            sources: components["schemas"]["SourceReference"][];
            geometry_recipe?: components["schemas"]["CircularRecipe"] | null;
        };
        /** Axis */
        Axis: {
            /** Name */
            name: string;
            /** Label */
            label: string;
            /**
             * Unit
             * @enum {string}
             */
            unit: "m" | "m^2" | "K" | "A" | "V" | "Hz" | "K*m/W" | "W/(m*K)" | "W/m" | "1" | "s" | "ohm/m";
            /** Minimum */
            minimum?: number | null;
            /** Maximum */
            maximum?: number | null;
            /**
             * Levels
             * @default 2
             */
            levels?: number;
            /** Bindings */
            bindings?: components["schemas"]["Binding"][];
            /** Choices */
            choices?: components["schemas"]["Choice"][];
            /** Source */
            source: string;
        };
        /** Backfill */
        Backfill: {
            /** Id */
            id: string;
            /**
             * Label
             * @default 回填区
             */
            label?: string;
            /** Material */
            material: string;
            /** X */
            x: number;
            /** Z */
            z: number;
            /** Width */
            width: number;
            /** Height */
            height: number;
        };
        /** BatchCase */
        BatchCase: {
            /** Case Id */
            case_id: string;
            /** Label */
            label: string;
            /** Input */
            input: {
                [key: string]: unknown;
            };
            /** Parameters */
            parameters?: {
                [key: string]: unknown;
            };
            /** Metadata */
            metadata?: {
                [key: string]: unknown;
            };
        };
        /** BindModel */
        BindModel: {
            /** Expected Revision */
            expected_revision: number;
            /** Model Id */
            model_id: string;
            /** Content Sha256 */
            content_sha256: string;
        };
        /** Binding */
        Binding: {
            /** Pointer */
            pointer: string;
            /**
             * Target Unit
             * @enum {string}
             */
            target_unit: "m" | "m^2" | "K" | "A" | "V" | "Hz" | "K*m/W" | "W/(m*K)" | "W/m" | "1" | "s" | "ohm/m";
            /**
             * Scale
             * @default 1
             */
            scale?: number;
            /**
             * Offset
             * @default 0
             */
            offset?: number;
            /**
             * Reciprocal
             * @default false
             */
            reciprocal?: boolean;
            /**
             * Mode
             * @default set
             * @enum {string}
             */
            mode?: "set" | "add" | "multiply";
        };
        /** Body_upload_api_documents_post */
        Body_upload_api_documents_post: {
            /**
             * File
             * Format: binary
             * @description Original manufacturer PDF; <=64 MiB and <=500 pages. No automatic cloud upload.
             */
            file: string;
        };
        /** Bonding */
        Bonding: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "both_ends" | "single_point" | "cross_bonded" | "none" | "unspecified";
            /** Minor Section Lengths */
            minor_section_lengths?: number[];
            /**
             * Transposed
             * @default false
             */
            transposed?: boolean;
            /**
             * Section Permutations
             * @description 每小段中三条连续护套支路所处的位置索引（0,1,2）；顺序与 minor_section_lengths 的 m 值相同
             */
            section_permutations?: number[][];
            source?: components["schemas"]["Source"] | null;
        };
        /** Branch */
        Branch: {
            /** Expected Revision */
            expected_revision: number;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /** Name */
            name: string;
            document?: components["schemas"]["DomainDocument-Input"] | null;
        };
        /** Cable */
        Cable: {
            /**
             * Name
             * @default 演示 · Cu / XLPE 12/20 kV · 1×240
             */
            name?: string;
            /**
             * Conductor
             * @default copper
             * @enum {string}
             */
            conductor?: "copper" | "aluminium";
            /**
             * Area Mm2
             * @default 240
             */
            area_mm2?: number;
            /**
             * Fill Factor
             * @default 0.92
             */
            fill_factor?: number;
            /** R20 Ohm Km */
            r20_ohm_km?: number | null;
            /**
             * Conductor Screen Mm
             * @default 0.6
             */
            conductor_screen_mm?: number;
            /**
             * Insulation Mm
             * @default 5.5
             */
            insulation_mm?: number;
            /**
             * Insulation Screen Mm
             * @default 0.7
             */
            insulation_screen_mm?: number;
            /**
             * Metallic Screen Mm
             * @default 0.5
             */
            metallic_screen_mm?: number;
            /**
             * Jacket Mm
             * @default 2.5
             */
            jacket_mm?: number;
            /**
             * Insulation Rho K M W
             * @default 3.5
             */
            insulation_rho_k_m_w?: number;
            /**
             * Jacket Rho K M W
             * @default 3.5
             */
            jacket_rho_k_m_w?: number;
            /**
             * Semicon Rho K M W
             * @default 2.5
             */
            semicon_rho_k_m_w?: number;
            /**
             * U0 Kv
             * @default 12
             */
            u0_kv?: number;
            /**
             * Frequency Hz
             * @default 50
             * @enum {integer}
             */
            frequency_hz?: 50 | 60;
            /**
             * Relative Permittivity
             * @default 2.3
             */
            relative_permittivity?: number;
            /**
             * Tan Delta
             * @default 0.0004
             */
            tan_delta?: number;
            /**
             * Ac Extra Factor
             * @default 0.05
             */
            ac_extra_factor?: number;
            /**
             * Screen Loss Factor
             * @default 0.05
             */
            screen_loss_factor?: number;
            /**
             * Max Temperature C
             * @default 90
             */
            max_temperature_c?: number;
        };
        /** CableExample */
        CableExample: {
            document: components["schemas"]["DomainDocument-Output"];
            /** @description Compatibility example only; execution uses document. */
            scenario: components["schemas"]["Scenario"];
            /** Source */
            source: string;
        };
        /** CableHeatOptions */
        CableHeatOptions: {
            electrical: components["schemas"]["ElectricalHeatSource"] | null;
            /**
             * Fixed Layer Heat W M
             * @description Every conductor/layer UID including explicit zero; power W/m.
             */
            fixed_layer_heat_w_m: {
                [key: string]: number;
            };
            /**
             * Prescribed Core Temperature K
             * @description Prescribed absolute core temperature K; cannot coexist with conductor heat.
             */
            prescribed_core_temperature_k?: number | null;
            /**
             * Equivalent Layers Acknowledged
             * @description Explicit acknowledgement of sourced equivalent thermal layers.
             */
            equivalent_layers_acknowledged: boolean;
        };
        /** CableInstance */
        CableInstance: {
            /** Id */
            id: string;
            /**
             * Phase
             * @enum {string}
             */
            phase: "A" | "B" | "C" | "L1" | "L2" | "L3" | "L1L2L3" | "N" | "PE" | "+" | "-";
            /**
             * Parallel Index
             * @default 1
             */
            parallel_index?: number;
        };
        /** CableModelVersion */
        "CableModelVersion-Input": {
            /** Name */
            name: string;
            /** Version */
            version: string;
            cable_type?: components["schemas"]["CableType-Input"] | null;
            /** Materials */
            materials?: components["schemas"]["Material"][];
            specification?: components["schemas"]["PublishedSpecification"] | null;
            /** Sources */
            sources: {
                [key: string]: components["schemas"]["Source"];
            };
            /**
             * Confirmed
             * @default false
             */
            confirmed?: boolean;
        };
        /** CableModelVersion */
        "CableModelVersion-Output": {
            /** Name */
            name: string;
            /** Version */
            version: string;
            cable_type?: components["schemas"]["CableType-Output"] | null;
            /** Materials */
            materials?: components["schemas"]["Material"][];
            specification?: components["schemas"]["PublishedSpecification"] | null;
            /** Sources */
            sources: {
                [key: string]: components["schemas"]["Source"];
            };
            /**
             * Confirmed
             * @default false
             */
            confirmed?: boolean;
        };
        /** CableType */
        "CableType-Input": {
            /** Id */
            id: string;
            /** Label */
            label: string;
            /**
             * Construction
             * @enum {string}
             */
            construction: "single_core" | "three_core" | "multi_core";
            rating: components["schemas"]["Rating"];
            /** Cores */
            cores: components["schemas"]["Core"][];
            /** Common Layers */
            common_layers: components["schemas"]["Layer"][];
            /**
             * Core Lay Length
             * @description 三芯成缆完整绞合一周的轴向长度，m；区别于导体单丝绞距
             */
            core_lay_length?: number | null;
        };
        /** CableType */
        "CableType-Output": {
            /** Id */
            id: string;
            /** Label */
            label: string;
            /**
             * Construction
             * @enum {string}
             */
            construction: "single_core" | "three_core" | "multi_core";
            rating: components["schemas"]["Rating"];
            /** Cores */
            cores: components["schemas"]["Core"][];
            /** Common Layers */
            common_layers: components["schemas"]["Layer"][];
            /**
             * Core Lay Length
             * @description 三芯成缆完整绞合一周的轴向长度，m；区别于导体单丝绞距
             */
            core_lay_length?: number | null;
        };
        /** Candidate */
        Candidate: {
            /**
             * Id
             * @description Stable candidate evidence identity.
             */
            id: string;
            /**
             * Field
             * @description Canonical structural/electrical field name.
             */
            field: string;
            /**
             * Raw Value
             * @description Value as printed, before SI conversion.
             */
            raw_value: number;
            /**
             * Raw Unit
             * @description Explicit unit printed in source.
             */
            raw_unit: string;
            /**
             * Value Si
             * @description Plugin-converted positive SI value.
             */
            value_si: number;
            /**
             * Unit Si
             * @description SI length, longitudinal resistance or mass unit.
             * @enum {string}
             */
            unit_si: "m" | "ohm/m" | "kg/m";
            model: components["schemas"]["SelectedModel"];
            /**
             * Page
             * @description 1-based source page.
             */
            page: number;
            /**
             * Quote
             * @description Exact numeric source fragment.
             */
            quote: string;
            /**
             * Bbox Pt
             * @description Source evidence rectangle [left,top,right,bottom], PDF points, top-left origin. Original text uses numeric cells/glyphs; OCR uses the containing table block, not invented cell coordinates.
             */
            bbox_pt: number[];
            /**
             * Basis
             * @description Manufacturer published value or stated maximum; never relabeled as measured/standard data.
             * @enum {string}
             */
            basis: "manufacturer" | "manufacturer_limit";
            /**
             * Ambiguities
             * @description Conflicts/recognition uncertainty requiring explicit human decisions.
             */
            ambiguities: string[];
            /**
             * Evidence Source
             * @description Original PDF glyphs or separately stored OCR evidence; both require individual human review.
             * @default original
             * @enum {string}
             */
            evidence_source?: "original" | "ocr";
            /**
             * Evidence Sha256
             * @description SHA256 of separately stored OCR page evidence when applicable.
             */
            evidence_sha256?: string | null;
            /**
             * Extraction Origin
             * @description Producer of this candidate, retained by hybrid merging.
             * @default rules
             * @enum {string}
             */
            extraction_origin?: "rules" | "llm";
            /**
             * Header Quote
             * @description Verified original field/unit header supporting LLM candidates.
             */
            header_quote?: string | null;
            /**
             * Header Bbox Pt
             * @description Verified header rectangle in PDF points.
             */
            header_bbox_pt?: number[] | null;
        };
        /** CandidateCompletion */
        CandidateCompletion: {
            method: components["schemas"]["Method"];
            /** Parameters */
            parameters: {
                [key: string]: unknown;
            };
        };
        /** CandidateFilters */
        CandidateFilters: {
            /** Voltage V */
            voltage_v?: number | null;
            /** Conductor */
            conductor?: ("copper_bare" | "copper_coated" | "aluminium") | null;
            /** Minimum Area M2 */
            minimum_area_m2?: number | null;
            /** Maximum Area M2 */
            maximum_area_m2?: number | null;
        };
        /** CaptureAsset */
        CaptureAsset: {
            /** Expected Revision */
            expected_revision: number;
            /** Name */
            name: string;
        };
        /** Change */
        Change: {
            /** Path */
            path: string;
            /** Value */
            value: unknown;
        };
        /** CheckCase */
        CheckCase: {
            /** Case Id */
            case_id: string;
            /** Status */
            status: string;
            /** Results */
            results: {
                [key: string]: components["schemas"]["JsonValue"];
            }[];
            /** Artifacts */
            artifacts: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            error?: components["schemas"]["PreflightError"] | null;
            /** Evidence */
            evidence?: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /**
             * Artifact Digests
             * @description Original output file SHA256 by artifact type.
             */
            artifact_digests?: {
                [key: string]: string;
            };
            /** Warnings */
            warnings?: {
                [key: string]: components["schemas"]["JsonValue"];
            }[];
            method?: components["schemas"]["Method"] | null;
        } & {
            [key: string]: unknown;
        };
        /** Choice */
        Choice: {
            /** Label */
            label: string;
            /** Changes */
            changes: {
                [key: string]: number;
            };
            /**
             * Mode
             * @default set
             * @enum {string}
             */
            mode?: "set" | "add";
        };
        /** ChooseModel */
        ChooseModel: {
            /** Model Id */
            model_id: string;
            /** Content Sha256 */
            content_sha256: string;
        };
        /** Circuit */
        "Circuit-Input": {
            /** Id */
            id: string;
            /** Label */
            label: string;
            system: components["schemas"]["System"];
            /** Cable Type */
            cable_type: string;
            /** Cables */
            cables: components["schemas"]["CableInstance"][];
            bonding: components["schemas"]["Bonding"];
            electrical_topology?: components["schemas"]["PhaseTopology"] | null;
        };
        /** Circuit */
        "Circuit-Output": {
            /** Id */
            id: string;
            /** Label */
            label: string;
            system: components["schemas"]["System"];
            /** Cable Type */
            cable_type: string;
            /** Cables */
            cables: components["schemas"]["CableInstance"][];
            bonding: components["schemas"]["Bonding"];
            electrical_topology?: components["schemas"]["PhaseTopology"] | null;
        };
        /** CircularLayer */
        CircularLayer: {
            /** Uid */
            uid: string;
            /**
             * Role
             * @enum {string}
             */
            role: "conductor" | "conductor_screen" | "insulation" | "insulation_screen" | "metallic_screen" | "jacket";
            /** Inner Radius M */
            inner_radius_m: number;
            /** Outer Radius M */
            outer_radius_m: number;
        };
        /** CircularRecipe */
        CircularRecipe: {
            /**
             * Family
             * @default single_core_circular
             * @constant
             */
            family?: "single_core_circular";
            /**
             * Representation
             * @default declarative_recipe
             * @constant
             */
            representation?: "declarative_recipe";
            /** Length M */
            length_m: number;
            /** Layers */
            layers: components["schemas"]["CircularLayer"][];
        };
        /** ComparedField */
        ComparedField: {
            /** Field */
            field: string;
            /** Left */
            left: components["schemas"]["Candidate"][];
            /** Right */
            right: components["schemas"]["Candidate"][];
            /**
             * Agrees
             * @description Exact SI value/unit sets agree; ambiguity remains independently visible.
             */
            agrees: boolean;
        };
        /** Comparison */
        Comparison: {
            /** Run Ids */
            run_ids: string[];
        };
        /** Condition */
        Condition: {
            /** Uid */
            uid: string;
            /**
             * Selector
             * @enum {string}
             */
            selector: "outer" | "x" | "z" | "circle";
            /** Values */
            values: number[];
            /**
             * Kind
             * @enum {string}
             */
            kind: "temperature" | "convection" | "insulated" | "magnetic_potential";
            /** Value */
            value: number | null;
            /** H W M2 K */
            h_w_m2_k?: number | null;
        };
        /** Conductor */
        Conductor: {
            /** Material */
            material: string;
            /**
             * Form
             * @enum {string}
             */
            form: "unspecified" | "solid_round" | "stranded_round" | "stranded_round_compacted" | "segmental" | "hollow" | "sectoral";
            /** Nominal Area */
            nominal_area: number;
            /** Diameter */
            diameter: number;
            /** R20 */
            r20?: number | null;
            /** Conductor Class */
            conductor_class?: (1 | 2 | 5 | 6) | null;
            /** R20 Basis */
            r20_basis?: ("design" | "measurement" | "manufacturer_limit") | null;
            /** Inner Diameter */
            inner_diameter?: number | null;
            /** Segments */
            segments?: number | null;
            /** Wire Count */
            wire_count?: number | null;
            /** Insulated Wires */
            insulated_wires?: boolean | null;
            /** Wire Diameter */
            wire_diameter?: number | null;
            /** Lay Length */
            lay_length?: number | null;
            /** Lay Direction */
            lay_direction?: ("left" | "right") | null;
            /**
             * Lay Factor
             * @description 导体用料绞入系数；明确制造输入，未知时为空
             */
            lay_factor?: number | null;
        };
        /** Core */
        Core: {
            /** Id */
            id: string;
            conductor: components["schemas"]["Conductor"];
            /** Layers */
            layers: components["schemas"]["Layer"][];
            /**
             * X
             * @default 0
             */
            x?: number;
            /**
             * Z
             * @default 0
             */
            z?: number;
        };
        /** CoupledParameters */
        "CoupledParameters-Input": {
            electromagnetic_options: components["schemas"]["ElectromagneticDomainOptions"];
            /** @description Field mesh lengths m; P1 thermal transfer. */
            mesh: components["schemas"]["MeshControls"];
            /**
             * Thermal Boundaries
             * @description Thermal conditions; temperature values K, convection h W/(m²*K).
             */
            thermal_boundaries: components["schemas"]["Condition"][];
            /** Material Validity */
            material_validity: {
                [key: string]: components["schemas"]["MaterialValidity"];
            };
            /**
             * Initial Temperature K
             * @description Initial absolute temperature K.
             */
            initial_temperature_k: number;
            /**
             * Temperature Tolerance K
             * @description Iteration temperature update tolerance K.
             * @default 0.0001
             */
            temperature_tolerance_k?: number;
            /**
             * Power Relative Tolerance
             * @description Dimensionless relative power update tolerance.
             * @default 0.000001
             */
            power_relative_tolerance?: number;
            /**
             * Maximum Iterations
             * @description Bounded coupled iteration count.
             * @default 60
             */
            maximum_iterations?: number;
            /**
             * Relaxation
             * @description Dimensionless relaxation factor in (0,1].
             * @default 0.7
             */
            relaxation?: number;
        };
        /** CoupledParameters */
        "CoupledParameters-Output": {
            electromagnetic_options: components["schemas"]["ElectromagneticDomainOptions"];
            /** @description Field mesh lengths m; P1 thermal transfer. */
            mesh: components["schemas"]["MeshControls"];
            /**
             * Thermal Boundaries
             * @description Thermal conditions; temperature values K, convection h W/(m²*K).
             */
            thermal_boundaries: components["schemas"]["Condition"][];
            /** Material Validity */
            material_validity: {
                [key: string]: components["schemas"]["MaterialValidity"];
            };
            /**
             * Initial Temperature K
             * @description Initial absolute temperature K.
             */
            initial_temperature_k: number;
            /**
             * Temperature Tolerance K
             * @description Iteration temperature update tolerance K.
             * @default 0.0001
             */
            temperature_tolerance_k?: number;
            /**
             * Power Relative Tolerance
             * @description Dimensionless relative power update tolerance.
             * @default 0.000001
             */
            power_relative_tolerance?: number;
            /**
             * Maximum Iterations
             * @description Bounded coupled iteration count.
             * @default 60
             */
            maximum_iterations?: number;
            /**
             * Relaxation
             * @description Dimensionless relaxation factor in (0,1].
             * @default 0.7
             */
            relaxation?: number;
        };
        /** Create */
        Create: {
            scenario?: components["schemas"]["Scenario"];
        };
        /** CreateStudy */
        CreateStudy: {
            /** Title */
            title: string;
            /**
             * Task
             * @description Study objective; simulation tasks submit asynchronously to Slurm.
             */
            task?: ("rating" | "operating" | "target" | "transient-temperature" | "sheath-losses" | "electrothermal-steady") | null;
            method: components["schemas"]["Method"];
            /**
             * Input Source
             * @default domain
             * @enum {string}
             */
            input_source?: "domain" | "study";
            /** Method Input */
            method_input?: {
                [key: string]: unknown;
            } | null;
            /**
             * Parameters
             * @description Saved capability parameters. Simulation task models are exposed in OpenAPI; other plugins use GET /api/input-contracts parameter_schema. SI lengths m, time s, temperature K, RMS current A.
             */
            parameters?: {
                [key: string]: unknown;
            } | components["schemas"]["TransientParameters-Input"] | components["schemas"]["SheathLossParameters-Input"] | components["schemas"]["CoupledParameters-Input"];
            /** Input Sources */
            input_sources?: {
                [key: string]: components["schemas"]["Source"];
            };
            /** Candidate Completions */
            candidate_completions?: {
                [key: string]: components["schemas"]["CandidateCompletion"];
            };
            driver?: components["schemas"]["Driver"];
            /** Crosschecks */
            crosschecks?: components["schemas"]["CrosscheckMethod"][];
            verification?: components["schemas"]["ThermalConvergence"] | null;
            /**
             * Modules
             * @description Independently configured study modules; each freezes its own method and parameters at run acceptance.
             */
            modules?: {
                [key: string]: components["schemas"]["StudyConfiguration-Input"];
            };
            /** Expected Revision */
            expected_revision: number;
        };
        /** CreateStudyWorkspace */
        CreateStudyWorkspace: {
            /** Model Id */
            model_id: string;
            /** Content Sha256 */
            content_sha256: string;
            candidate_completion?: components["schemas"]["CandidateCompletion"] | null;
            /** Example Id */
            example_id?: string | null;
            /** Three Core Layout */
            three_core_layout?: ("three_core_buried_single" | "three_core_buried_horizontal" | "three_core_ducts_horizontal" | "three_core_ducts_2x3" | "three_core_ducts_3x3") | null;
            /** Target Current A */
            target_current_a?: number | null;
        };
        /** CrosscheckMethod */
        CrosscheckMethod: {
            method: components["schemas"]["Method"];
            /** Parameters */
            parameters?: {
                [key: string]: unknown;
            };
        };
        /** CurrentDeliveryRequest */
        CurrentDeliveryRequest: {
            /**
             * Run Ids
             * @description One current study run, or geometry plus rating-table runs for a specification.
             */
            run_ids: string[];
            /**
             * Request Id
             * @description Retry identity; reuse with identical source runs.
             */
            request_id?: string | null;
        };
        /** Decision */
        Decision: {
            /**
             * Candidate Id
             * @description Evidence ID being individually reviewed.
             */
            candidate_id: string;
            /**
             * Action
             * @enum {string}
             */
            action: "accept" | "modify" | "reject";
            /**
             * Value
             * @description Modified raw numeric value; required only for modify.
             */
            value?: number | null;
            /**
             * Unit
             * @description Modified raw unit; converted by the extraction plugin.
             */
            unit?: ("mm" | "cm" | "m" | "ohm/km" | "ohm/m" | "kg/km" | "kg/m" | "kg/100m") | null;
            /**
             * Reason
             * @description Human reason/context, especially when editing or resolving ambiguity.
             */
            reason: string;
        };
        /** DeliveryRequest */
        DeliveryRequest: {
            /** Run Ids */
            run_ids: string[];
        };
        /** DeliveryResult */
        DeliveryResult: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Workspace
             * Format: uuid
             */
            workspace: string;
            /** Sources */
            sources: components["schemas"]["DeliverySource"][];
            /**
             * Renderer
             * @description Versioned report renderer.
             */
            renderer: string;
            /**
             * Html
             * @description Saved HTML; export never reruns calculation.
             */
            html: string;
            /**
             * Digest
             * @description SHA256 of renderer, sources and HTML.
             */
            digest: string;
            /**
             * Created
             * @description UTC creation timestamp.
             */
            created: string;
        };
        /** DeliverySource */
        DeliverySource: {
            /**
             * Run Id
             * Format: uuid
             */
            run_id: string;
            /** Input Digest */
            input_digest: string;
            /** Output Digest */
            output_digest: string;
        };
        /** DeriveAsset */
        DeriveAsset: {
            /** Expected Revision */
            expected_revision: number;
            /** Content Sha256 */
            content_sha256: string;
            /** New Version */
            new_version: string;
        };
        /** DisclosureResponse */
        DisclosureResponse: {
            /**
             * Id
             * @description Saved outbound disclosure identity; scoped to exact document, region, provider and model.
             */
            id: string;
            /**
             * Document Sha256
             * @description Exact original SHA256.
             */
            document_sha256: string;
            scope: components["schemas"]["ExtractionScope"];
            /**
             * Service
             * @description Configured external service name.
             */
            service: string;
            /**
             * Endpoint
             * @description Exact destination chat-completions URL; secrets omitted.
             */
            endpoint: string;
            /**
             * Ocr Endpoint
             * @description Additional OCR destination for selected scanned images; included in the same explicit confirmation.
             */
            ocr_endpoint?: string | null;
            /**
             * Ocr Model
             * @description Pinned OCR model ID; separate from the field extraction model.
             */
            ocr_model?: string | null;
            /**
             * Provider Model
             * @description Configured external model ID.
             */
            provider_model: string;
            /**
             * Payload Sha256
             * @description Digest of exact selected text/tables or image payload; original PDF is not sent.
             */
            payload_sha256: string;
            /**
             * Disclosure Sha256
             * @description Digest to echo with explicit confirmation before any outbound request.
             */
            disclosure_sha256: string;
            /**
             * Content Kind
             * @enum {string}
             */
            content_kind: "selected_text_tables" | "selected_page_images" | "selected_text_and_images";
            /**
             * Available
             * @description Provider URL/model/key configured; no secrets returned.
             */
            available: boolean;
        };
        /** DocumentErrorDetail */
        DocumentErrorDetail: {
            /**
             * Code
             * @description Stable machine-readable error code.
             */
            code: string;
            /**
             * Message
             * @description Specific correction; no provider bodies, credentials or invented content.
             */
            message: string;
        };
        /** DocumentErrorResponse */
        DocumentErrorResponse: {
            detail: components["schemas"]["DocumentErrorDetail"];
        };
        /** DocumentPage */
        DocumentPage: {
            /**
             * Page
             * @description 1-based PDF page number.
             */
            page: number;
            /**
             * Width Pt
             * @description PDF page width in points (1/72 inch).
             */
            width_pt: number;
            /**
             * Height Pt
             * @description PDF page height in points.
             */
            height_pt: number;
            /**
             * Has Text
             * @description Original PDF text layer exists; OCR is a separate action.
             */
            has_text: boolean;
        };
        /** DocumentResponse */
        DocumentResponse: {
            /**
             * Id
             * @description Immutable original document identity.
             */
            id: string;
            /**
             * Name
             * @description Original filename; display only, never used as a filesystem path.
             */
            name: string;
            /**
             * Sha256
             * @description SHA256 of exact uploaded PDF bytes.
             */
            sha256: string;
            /**
             * Size Bytes
             * @description Original file size in bytes; limit 64 MiB.
             */
            size_bytes: number;
            /**
             * Page Count
             * @description Number of original PDF pages.
             */
            page_count: number;
            /**
             * Pages
             * @description Page dimensions and text-layer availability.
             */
            pages: components["schemas"]["DocumentPage"][];
            /**
             * Created
             * @description UTC import timestamp.
             */
            created: string;
        };
        /** DomainDocument */
        "DomainDocument-Input": {
            /**
             * Schema Version
             * @default cablesim.domain/1
             * @constant
             */
            schema_version?: "cablesim.domain/1";
            /** Name */
            name: string;
            /** Materials */
            materials: components["schemas"]["Material"][];
            /** Cable Types */
            cable_types: components["schemas"]["CableType-Input"][];
            /** Circuits */
            circuits: components["schemas"]["Circuit-Input"][];
            /** Sections */
            sections: components["schemas"]["Section-Input"][];
            /** Load Cases */
            load_cases: components["schemas"]["Load"][];
            /** Criteria */
            criteria?: {
                [key: string]: number;
            };
            /** Provenance */
            provenance?: {
                [key: string]: components["schemas"]["Source"];
            };
            /** Measurements */
            measurements?: components["schemas"]["FactoryMeasurement"][];
        };
        /** DomainDocument */
        "DomainDocument-Output": {
            /**
             * Schema Version
             * @default cablesim.domain/1
             * @constant
             */
            schema_version?: "cablesim.domain/1";
            /** Name */
            name: string;
            /** Materials */
            materials: components["schemas"]["Material"][];
            /** Cable Types */
            cable_types: components["schemas"]["CableType-Output"][];
            /** Circuits */
            circuits: components["schemas"]["Circuit-Output"][];
            /** Sections */
            sections: components["schemas"]["Section-Output"][];
            /** Load Cases */
            load_cases: components["schemas"]["Load"][];
            /** Criteria */
            criteria?: {
                [key: string]: number;
            };
            /** Provenance */
            provenance?: {
                [key: string]: components["schemas"]["Source"];
            };
            /** Measurements */
            measurements?: components["schemas"]["FactoryMeasurement"][];
        };
        /** Driver */
        Driver: {
            /**
             * Kind
             * @default single
             * @enum {string}
             */
            kind?: "single" | "sweep" | "selection" | "crosscheck" | "batch";
            /** Cases */
            cases?: components["schemas"]["BatchCase"][];
            /** Selected Case Ids */
            selected_case_ids?: string[] | null;
            /** Samples */
            samples?: components["schemas"]["Sample"][];
            /** Candidate Ids */
            candidate_ids?: string[];
            /**
             * Target Key
             * @default ampacity
             */
            target_key?: string;
            /**
             * Target Entity
             * @default circuit/c1
             */
            target_entity?: string;
            /** Target Entities */
            target_entities?: string[];
            /**
             * Target Unit
             * @default A
             */
            target_unit?: string;
            /** Target Condition */
            target_condition?: string | null;
            /**
             * Rating Basis
             * @description Ampacity selection basis: individual circuit increase with other saved loads held, or common balanced RMS current in all circuits simultaneously.
             * @default individual
             * @enum {string}
             */
            rating_basis?: "individual" | "simultaneous";
            /** Minimum */
            minimum?: number | null;
            /**
             * Allow Demo Candidates
             * @default false
             */
            allow_demo_candidates?: boolean;
            candidate_filters?: components["schemas"]["CandidateFilters"];
        };
        /** DuctAirResistance */
        DuctAirResistance: {
            /**
             * Resistance K M W
             * @description Sourced equivalent air thermal resistance K*m/W.
             */
            resistance_k_m_w: number;
            /**
             * Source
             * @description IEC run/engineering source for the equivalent air resistance.
             */
            source: string;
        };
        /** Edit */
        Edit: {
            /** Expected Revision */
            expected_revision: number;
            /** Changes */
            changes: components["schemas"]["Change"][];
            /**
             * Label
             * @default 属性编辑
             */
            label?: string;
        };
        /** EditAsset */
        EditAsset: {
            /** Expected Revision */
            expected_revision: number;
            release: components["schemas"]["AssetRelease"];
        };
        /** ElectricalHeatSource */
        ElectricalHeatSource: {
            /**
             * Ac Extra Factor
             * @description AC resistance excess over frozen DC resistance, dimensionless.
             */
            ac_extra_factor: number;
            /**
             * Sheath Loss Factor
             * @description Sheath/conductor loss ratio, dimensionless; explicit source required.
             */
            sheath_loss_factor: number;
            /**
             * Sheath Layer Uid
             * @description Actual non-conductor layer UID for sheath heat, or null for zero sheath loss.
             */
            sheath_layer_uid: string | null;
            /**
             * Source
             * @description Saved coefficient calculation or engineering source.
             */
            source: string;
        };
        /** ElectromagneticBackground */
        ElectromagneticBackground: {
            /** K W M K */
            k_w_m_k?: number | null;
            /** Heat Capacity J M3 K */
            heat_capacity_j_m3_k?: number | null;
            /**
             * Conductivity S M
             * @description Exterior conductivity S/m; explicit zero for nonconducting exterior.
             */
            conductivity_s_m: number;
            /**
             * Relative Permeability
             * @description Exterior relative magnetic permeability, dimensionless.
             */
            relative_permeability: number;
            /**
             * Relative Permeability Loss
             * @default 0
             */
            relative_permeability_loss?: number;
            /** Relative Permittivity */
            relative_permittivity?: number | null;
            /** Source */
            source: string;
        };
        /** ElectromagneticDomainOptions */
        ElectromagneticDomainOptions: {
            /**
             * Section Id
             * @description Saved section identity; geometry comes from that section.
             */
            section_id: string;
            /**
             * Load Id
             * @description Saved steady RMS current load identity; A.
             */
            load_id: string;
            /**
             * Bounds M
             * @description Finite x0,z0,x1,z1 computational bounds, m.
             */
            bounds_m: [
                number,
                number,
                number,
                number
            ];
            background: components["schemas"]["ElectromagneticBackground"];
            /** Material States */
            material_states: {
                [key: string]: components["schemas"]["MaterialTemperatureState"];
            };
            /**
             * Probes M
             * @description Probe x,z coordinates in m.
             */
            probes_m: [
                number,
                number
            ][];
            /**
             * Source
             * @description Source of finite domain and electromagnetic assumptions; bonding/phase come from saved domain.
             */
            source: string;
        };
        /** Enclosure */
        Enclosure: {
            /** Id */
            id: string;
            /**
             * Type
             * @enum {string}
             */
            type: "duct" | "duct_bank" | "tray" | "cleat_group" | "rack";
            /** X */
            x: number;
            /** Z */
            z: number;
            /** Material */
            material?: string | null;
            /** Inner Diameter */
            inner_diameter?: number | null;
            /** Outer Diameter */
            outer_diameter?: number | null;
            /** Width */
            width?: number | null;
            /** Height */
            height?: number | null;
            /** Contains */
            contains?: string[];
        };
        /** Execution */
        Execution: {
            /**
             * Backend
             * @default slurm
             * @enum {string}
             */
            backend?: "local" | "slurm";
            /**
             * Workers
             * @default 8
             */
            workers?: number;
            /**
             * Sample Timeout S
             * @default 300
             */
            sample_timeout_s?: number;
            /**
             * Slurm Parallelism
             * @default 32
             */
            slurm_parallelism?: number;
            /**
             * Slurm Wall Seconds
             * @default 360
             */
            slurm_wall_seconds?: number;
            /**
             * Slurm Memory Mb
             * @default 2048
             */
            slurm_memory_mb?: number;
            /**
             * Slurm Cpus Per Task
             * @default 1
             */
            slurm_cpus_per_task?: number;
        };
        /** ExtractionComparisonRequest */
        ExtractionComparisonRequest: {
            /**
             * Extraction Ids
             * @description Two completed runs on exactly the same document/model/pages/regions.
             */
            extraction_ids: string[];
        };
        /** ExtractionComparisonResponse */
        ExtractionComparisonResponse: {
            /** Document Sha256 */
            document_sha256: string;
            /** Extraction Ids */
            extraction_ids: string[];
            /** Methods */
            methods: {
                [key: string]: unknown;
            }[];
            /** Rows */
            rows: components["schemas"]["ComparedField"][];
        };
        /** ExtractionRequest */
        ExtractionRequest: {
            /**
             * Method
             * @description Rules with automatic offline OCR for scans (default); offline_ocr forces local CPU OCR; llm/hybrid and optional Mistral ocr require explicit outbound confirmation.
             * @enum {string}
             */
            method: "rules" | "offline_ocr" | "llm" | "ocr" | "hybrid";
            model: components["schemas"]["SelectedModel"];
            /**
             * Selections
             * @description Only these pages/regions are processed or disclosed.
             */
            selections: components["schemas"]["Selection"][];
            /**
             * Request Id
             * Format: uuid
             * @description Reuse this ID for retries/double-clicks; a different payload with the same ID is rejected.
             */
            request_id: string;
            /**
             * Disclosure Id
             * @description Required for llm/ocr; obtained before human confirms outbound disclosure.
             */
            disclosure_id?: string | null;
            /**
             * Disclosure Sha256
             * @description Exact acknowledged disclosure digest.
             */
            disclosure_sha256?: string | null;
            /**
             * Outbound Confirmed
             * @description Must be literal true after the user sees destination and selected content.
             */
            outbound_confirmed?: true | null;
        };
        /** ExtractionResponse */
        ExtractionResponse: {
            /** Id */
            id: string;
            /** Document Id */
            document_id: string;
            /** Document Sha256 */
            document_sha256: string;
            /** Request Id */
            request_id: string;
            /**
             * Status
             * @enum {string}
             */
            status: "accepted" | "running" | "succeeded" | "failed" | "interrupted";
            /**
             * Request
             * @description Saved method/scope/disclosure inputs without keys, PDF bytes or provider response.
             */
            request: {
                [key: string]: unknown;
            };
            /**
             * Method
             * @description Exact plugin/capability/version/release digest.
             */
            method: {
                [key: string]: unknown;
            };
            result?: components["schemas"]["ExtractionResult"] | null;
            /**
             * Error
             * @description Stable code, specific correction and failure state.
             */
            error?: {
                [key: string]: unknown;
            } | null;
            /** Result Sha256 */
            result_sha256?: string | null;
            /**
             * Snapshot Integrity
             * @description Older local development records without input seals remain readable but cannot create proposals.
             * @default verified
             * @enum {string}
             */
            snapshot_integrity?: "verified" | "unsealed";
            /**
             * Revision
             * @description Monotonically increasing human review revision.
             */
            revision: number;
            /**
             * Reviews
             * @description Saved individual decisions and SI normalized values.
             */
            reviews: {
                [key: string]: unknown;
            }[];
            /** Created */
            created: string;
        };
        /** ExtractionResult */
        ExtractionResult: {
            /**
             * Schema
             * @constant
             */
            schema: "cablesim.datasheet-candidates/1";
            /**
             * Method
             * @description Pinned extraction method version.
             */
            method: string;
            model: components["schemas"]["SelectedModel"];
            /** Candidates */
            candidates: components["schemas"]["Candidate"][];
            /**
             * Issues
             * @description Structured extraction diagnostics, never substitute invented candidates.
             */
            issues: {
                [key: string]: unknown;
            }[];
            /**
             * Provider Calls
             * @description Actual provider models, usage and latency; no credentials.
             */
            provider_calls?: components["schemas"]["ProviderCall"][];
            /**
             * Ocr Evidence
             * @description Separate OCR page/region evidence with original SHA, OCR model, response hash and recognized blocks; never replaces the original text layer.
             */
            ocr_evidence?: {
                [key: string]: unknown;
            }[];
            /**
             * Strategy
             * @description Executed extraction strategy; offline_ocr never sends source content to a service.
             * @default rules
             * @enum {string}
             */
            strategy?: "rules" | "offline_ocr" | "llm" | "ocr" | "hybrid";
        };
        /** ExtractionScope */
        ExtractionScope: {
            /**
             * Method
             * @description Rules with automatic offline OCR for scans (default); offline_ocr forces local CPU OCR; llm/hybrid and optional Mistral ocr require explicit outbound confirmation.
             * @enum {string}
             */
            method: "rules" | "offline_ocr" | "llm" | "ocr" | "hybrid";
            model: components["schemas"]["SelectedModel"];
            /**
             * Selections
             * @description Only these pages/regions are processed or disclosed.
             */
            selections: components["schemas"]["Selection"][];
        };
        /**
         * FactoryMeasurement
         * @description Reported product data is independent of design geometry and material facts.
         */
        FactoryMeasurement: {
            /** Id */
            id: string;
            /** Cable Type */
            cable_type: string;
            /** Core */
            core?: string | null;
            /**
             * Role
             * @enum {string}
             */
            role: "conductor" | "insulation" | "conductor_screen" | "insulation_screen" | "metallic_screen" | "metallic_sheath" | "bedding" | "separator" | "armour" | "oversheath";
            /**
             * Quantity
             * @enum {string}
             */
            quantity: "r20" | "minimum_thickness" | "maximum_thickness" | "mean_thickness" | "minimum_tape_thickness" | "screen_area";
            /** Value */
            value: number;
            /**
             * Unit
             * @enum {string}
             */
            unit: "ohm/m" | "m" | "m2";
            /**
             * Basis
             * @enum {string}
             */
            basis: "measurement" | "manufacturer_limit";
            source: components["schemas"]["Source"];
        };
        /** GeometryPreview */
        GeometryPreview: {
            /**
             * Expected Revision
             * @description Saved workspace revision; preview does not save input.
             */
            expected_revision: number;
            /** @description Complete preview input; lengths m, temperatures K, RMS currents A. */
            document: components["schemas"]["DomainDocument-Input"];
            /** @description Exact geometry capability and sealed plugin release. */
            method: components["schemas"]["Method"];
            /**
             * Parameters
             * @description Capability parameters from the installed input contract; SI units.
             */
            parameters: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /**
             * Reuse From
             * @description Prior preview request SHA256; optional cache hint only.
             */
            reuse_from?: string | null;
        };
        /** GeometryPreviewResult */
        GeometryPreviewResult: {
            /**
             * Status
             * @constant
             */
            status: "ready";
            /**
             * Effect
             * @constant
             */
            effect: "preview";
            method: components["schemas"]["ReleasePin"];
            /**
             * Input Sha256
             * @description Canonical domain input SHA256.
             */
            input_sha256: string;
            /**
             * Request Sha256
             * @description Executor request SHA256.
             */
            request_sha256: string;
            /**
             * Base Revision
             * @description Workspace revision at admission.
             */
            base_revision: number;
            /**
             * Environment
             * @description Observed execution environment.
             */
            environment: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /**
             * Artifacts
             * @description Verified CAD model/scene artifacts indexed by declared type.
             */
            artifacts: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /** Warnings */
            warnings: {
                [key: string]: components["schemas"]["JsonValue"];
            }[];
            profiling: components["schemas"]["PreviewProfiling"];
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** IecExample */
        IecExample: {
            /**
             * Input
             * @description Public synthetic scalar input; units defined by its input contract.
             */
            input: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /** Source */
            source: string;
            /** Source Sha256 */
            source_sha256: string;
            /**
             * Label
             * @description Example status; not manufacturer or licensed standard data.
             */
            label: string;
        };
        /** ImportAsset */
        ImportAsset: {
            /**
             * Schema Version
             * @default csp-asset/0.1
             * @constant
             */
            schema_version?: "csp-asset/0.1";
            release: components["schemas"]["AssetRelease"];
        };
        /** InputContract */
        InputContract: {
            method: components["schemas"]["Method"];
            /**
             * Input Schema
             * @description Versioned plugin input schema identity.
             */
            input_schema: string;
            /**
             * Schema
             * @description Complete input JSON Schema with field unit descriptions.
             */
            schema: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /**
             * Parameter Schema
             * @description Capability parameter JSON Schema; SI units.
             */
            parameter_schema: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /** Standalone Schema */
            standalone_schema?: {
                [key: string]: components["schemas"]["JsonValue"];
            } | null;
            /**
             * Schema Digest
             * @description Published input schema SHA256.
             */
            schema_digest?: string | null;
            /**
             * Source
             * @description Repository-relative contract source.
             */
            source?: string | null;
            /** Source Sha256 */
            source_sha256?: string | null;
            /**
             * Parameter Source
             * @description Host admission model source when it adds typed presentation fields to the plugin contract.
             */
            parameter_source?: string | null;
            /** Parameter Source Sha256 */
            parameter_source_sha256?: string | null;
            /** Input Sources */
            input_sources: ("domain" | "study")[];
            /**
             * Reference Only
             * @default false
             */
            reference_only?: boolean;
            /**
             * Tasks
             * @description Supported study task identities.
             */
            tasks: string[];
            /** Engineering Fields */
            engineering_fields?: {
                [key: string]: components["schemas"]["JsonValue"];
            }[] | null;
        };
        /** InputFieldError */
        InputFieldError: {
            /**
             * Loc
             * @description Exact failing request-field path.
             */
            loc: (string | number)[];
            /** Msg */
            msg: string;
            /** Type */
            type: string;
        };
        /** InputFieldErrorResponse */
        InputFieldErrorResponse: {
            /** Detail */
            detail: components["schemas"]["InputFieldError"][];
        };
        /** Installation */
        Installation: {
            /**
             * Arrangement
             * @default flat
             * @enum {string}
             */
            arrangement?: "flat" | "trefoil";
            /**
             * Depth M
             * @default 0.8
             */
            depth_m?: number;
            /**
             * Spacing M
             * @default 0.12
             */
            spacing_m?: number;
            /**
             * Ambient Temperature C
             * @default 25
             */
            ambient_temperature_c?: number;
            /**
             * Soil Rho K M W
             * @default 1.2
             */
            soil_rho_k_m_w?: number;
        };
        JsonValue: unknown;
        /** Layer */
        Layer: {
            /**
             * Role
             * @enum {string}
             */
            role: "conductor_screen" | "insulation" | "insulation_screen" | "metallic_screen" | "metallic_sheath" | "bedding" | "separator" | "filler" | "binder" | "armour" | "oversheath";
            /** Material */
            material: string;
            /** Thickness */
            thickness: number;
            /** Form */
            form?: ("wires" | "tape" | "smooth" | "corrugated" | "unspecified") | null;
            /** Wire Count */
            wire_count?: number | null;
            /** Wire Diameter */
            wire_diameter?: number | null;
            /** Lay Length */
            lay_length?: number | null;
            /** Overlap */
            overlap?: number | null;
            /** Tape Width */
            tape_width?: number | null;
            /** Lay Direction */
            lay_direction?: ("left" | "right") | null;
            /**
             * Minimum Thickness
             * @description 最薄点实测值 / m；不以标称厚度代替
             */
            minimum_thickness?: number | null;
            /**
             * Maximum Thickness
             * @description 最大厚度实测值 / m
             */
            maximum_thickness?: number | null;
            /**
             * Mean Thickness
             * @description 厚度平均实测值 / m；不以标称厚度代替
             */
            mean_thickness?: number | null;
            /**
             * Nominal Tape Thickness
             * @description 单带标称厚度 / m；区别于层的径向厚度
             */
            nominal_tape_thickness?: number | null;
            /** Tape Count */
            tape_count?: number | null;
            /** Tape Application */
            tape_application?: ("helical_overlap" | "two_tape_gap" | "longitudinal") | null;
            /** Minimum Overlap */
            minimum_overlap?: number | null;
            /** Reverse Binder Thickness */
            reverse_binder_thickness?: number | null;
            /** Reverse Binder Width */
            reverse_binder_width?: number | null;
            /** Reverse Binder Count */
            reverse_binder_count?: number | null;
            /** Screen Inner Diameter */
            screen_inner_diameter?: number | null;
            /** Minimum Tape Thickness */
            minimum_tape_thickness?: number | null;
            /**
             * Longitudinal R20
             * @description 金属层沿成品电缆轴向的20°C电阻，Ω/m；铜带接触电阻不能由单带截面代替
             */
            longitudinal_r20?: number | null;
            /** Longitudinal Resistance Basis */
            longitudinal_resistance_basis?: ("dc" | "power_frequency_ac") | null;
            /**
             * Longitudinal Resistance Frequency
             * @description 纵向交流电阻的测量频率，Hz；不能以直流值替代钢丝铠装工频电阻
             */
            longitudinal_resistance_frequency?: number | null;
            /**
             * Tape Gap
             * @description 双带间隙绕包的轴向间隙，m
             */
            tape_gap?: number | null;
        };
        /** LayoutPreview */
        LayoutPreview: {
            /** Expected Revision */
            expected_revision: number;
            document: components["schemas"]["DomainDocument-Input"];
            /**
             * Kind
             * @enum {string}
             */
            kind: "trefoil" | "flat" | "double_trefoil" | "double_flat" | "ducts" | "ducts_2x3" | "ducts_3x3" | "duct_bank" | "backfill" | "tunnel" | "tray" | "three_core_buried_single" | "three_core_buried_horizontal" | "three_core_ducts_horizontal" | "three_core_ducts_2x3" | "three_core_ducts_3x3";
            /**
             * Depth
             * @default 0.8
             */
            depth?: number;
            /** Spacing */
            spacing?: number | null;
        };
        /** Load */
        Load: {
            /** Id */
            id: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "steady" | "cyclic" | "emergency" | "short_circuit" | "time_series";
            /**
             * Currents
             * @description SI 电流 A；回路 ID 为默认值，电缆 ID 为逐根覆盖值
             */
            currents?: {
                [key: string]: number;
            };
            /** Profile */
            profile?: {
                [key: string]: components["schemas"]["Series"];
            };
            /** Base Current */
            base_current?: {
                [key: string]: number;
            };
            /** Duration */
            duration?: number | null;
            /** Period */
            period?: number | null;
            /** Preload */
            preload?: string | null;
            /** Initial */
            initial?: string | null;
        };
        /** Lock */
        Lock: {
            /** Expected Revision */
            expected_revision: number;
            /** Path */
            path: string;
            /** Locked */
            locked: boolean;
        };
        /** LossTemperatureAxis */
        LossTemperatureAxis: {
            /** Entity */
            entity: string;
            /**
             * State
             * @enum {string}
             */
            state: "conductor_temperature_c" | "sheath_temperature_c";
            /** Regions */
            regions: string[];
            /** Values C */
            values_c: number[];
        };
        /** LossTemperatureTable */
        LossTemperatureTable: {
            /** Axes */
            axes: components["schemas"]["LossTemperatureAxis"][];
            /** Resistivity Laws */
            resistivity_laws: {
                [key: string]: components["schemas"]["ResistivityLaw"];
            };
            /** Current Scale Range */
            current_scale_range: [
                number,
                number
            ];
            /** Maximum Validation Absolute Error */
            maximum_validation_absolute_error: number;
        };
        /** Material */
        Material: {
            /** Id */
            id: string;
            /** Label */
            label: string;
            /**
             * Category
             * @enum {string}
             */
            category: "conductor" | "semiconductor" | "insulation" | "metal" | "polymer" | "filler" | "soil" | "backfill" | "concrete" | "duct" | "fluid";
            /** Standard Kind */
            standard_kind?: ("copper_bare" | "copper_coated" | "aluminium" | "lead" | "XLPE" | "PVC" | "EPR" | "HEPR" | "other") | null;
            /** Thermal Resistivity */
            thermal_resistivity?: number | null;
            /** Volumetric Heat Capacity */
            volumetric_heat_capacity?: number | null;
            /** Electrical Resistivity 20 */
            electrical_resistivity_20?: number | null;
            /** Temperature Coefficient 20 */
            temperature_coefficient_20?: number | null;
            /** Relative Permittivity */
            relative_permittivity?: number | null;
            /** Loss Tangent */
            loss_tangent?: number | null;
            /** Relative Permeability */
            relative_permeability?: number | null;
            /** Emissivity */
            emissivity?: number | null;
            /** Solar Absorptivity */
            solar_absorptivity?: number | null;
            /** Dry Thermal Resistivity */
            dry_thermal_resistivity?: number | null;
            /** Critical Temperature Rise */
            critical_temperature_rise?: number | null;
            /**
             * Density
             * @description 质量密度 / kg/m³；未知时为空
             */
            density?: number | null;
        };
        /** MaterialTemperatureState */
        MaterialTemperatureState: {
            /**
             * Temperature K
             * @description Electrical material state temperature K.
             */
            temperature_k: number;
            /**
             * Nonconducting
             * @description Explicit nonconducting assumption; metals cannot be silently removed.
             */
            nonconducting: boolean;
            /**
             * Source
             * @description Engineering/material-state source.
             */
            source: string;
        };
        /** MaterialValidity */
        MaterialValidity: {
            /**
             * Minimum Temperature K
             * @description Lower valid absolute temperature, K.
             */
            minimum_temperature_k: number;
            /**
             * Maximum Temperature K
             * @description Upper valid absolute temperature, K.
             */
            maximum_temperature_k: number;
            /**
             * Source
             * @description Published or engineering material law validity source.
             */
            source: string;
        };
        /** Medium */
        Medium: {
            /** Material */
            material?: string | null;
            /** Surface Temperature */
            surface_temperature?: number | components["schemas"]["Series"] | null;
            /** Air Temperature */
            air_temperature?: number | components["schemas"]["Series"] | null;
            /** Wind Speed */
            wind_speed?: number | null;
            /** Solar Irradiance */
            solar_irradiance?: number | null;
            /** Ventilation */
            ventilation?: ("natural" | "forced" | "none") | null;
        };
        /** MeshControls */
        MeshControls: {
            /** Size M */
            size_m: number;
            /** Far Size M */
            far_size_m: number;
            /** Transition M */
            transition_m: number;
            /**
             * Max Nodes
             * @default 60000
             */
            max_nodes?: number;
            /** Probe Cell Size M */
            probe_cell_size_m?: number | null;
            /** Exterior Growth Start M */
            exterior_growth_start_m?: number | null;
            /**
             * Exterior Growth Rate
             * @default 0.1
             */
            exterior_growth_rate?: number;
            /** Field Order */
            field_order?: (1 | 2) | null;
            /**
             * Minimum Circle Segments
             * @default 8
             */
            minimum_circle_segments?: number;
        };
        /** Method */
        Method: {
            /**
             * Plugin Id
             * @description Installed plugin identity.
             */
            plugin_id: string;
            /**
             * Capability
             * @description Declared capability identity in this exact release.
             */
            capability: string;
            /**
             * Version
             * @description Exact plugin version; never resolve latest implicitly.
             */
            version: string;
            /**
             * Release Digest
             * @description Sealed release manifest SHA256.
             */
            release_digest: string;
        };
        /** PageResponse */
        PageResponse: {
            /**
             * Schema
             * @constant
             */
            schema: "cablesim.datasheet-page/1";
            /** Page */
            page: number;
            /**
             * Width Pt
             * @description PDF points.
             */
            width_pt: number;
            /**
             * Height Pt
             * @description PDF points.
             */
            height_pt: number;
            /**
             * Coordinate System
             * @constant
             */
            coordinate_system: "pdf-points-top-left-y-down";
            /**
             * Text
             * @description Original text layer; OCR does not overwrite it.
             */
            text: string;
            /** Lines */
            lines: components["schemas"]["TextCell"][];
            /** Words */
            words: components["schemas"]["TextCell"][];
            /** Tables */
            tables: components["schemas"]["PageTable"][];
            /**
             * Text Source
             * @enum {string}
             */
            text_source: "original" | "none";
            /**
             * Requires Ocr
             * @description No usable parameter text layer: empty or image-dominant page containing only a few native labels/page numbers. Rules use local CPU OCR without outbound requests.
             * @default false
             */
            requires_ocr?: boolean;
        };
        /** PageTable */
        PageTable: {
            /** Bbox */
            bbox: number[];
            /** Rows */
            rows: (components["schemas"]["TextCell"] | null)[][];
            /**
             * Strategy
             * @enum {string}
             */
            strategy: "lines" | "text";
        };
        /** ParameterSpace */
        ParameterSpace: {
            /**
             * Schema Version
             * @default cablesim.parameter-space/1
             * @constant
             */
            schema_version?: "cablesim.parameter-space/1";
            /**
             * Sampling
             * @enum {string}
             */
            sampling: "grid" | "latin_hypercube" | "random";
            /** Sample Count */
            sample_count: number;
            /**
             * Seed
             * @default 0
             */
            seed?: number;
            /** Axes */
            axes: components["schemas"]["Axis"][];
            /** Source */
            source: string;
        };
        /** PayloadFile */
        PayloadFile: {
            /** Path */
            path: string;
            /** Sha256 */
            sha256: string;
            /** Size Bytes */
            size_bytes: number;
        };
        /** PhaseTopology */
        PhaseTopology: {
            /**
             * Phase Sequence
             * @enum {string}
             */
            phase_sequence: "ABC" | "ACB";
            /**
             * Reference Angle Rad
             * @description A/L1 相相角，rad；所有回路共用同一时间参考
             */
            reference_angle_rad: number;
            source: components["schemas"]["Source"];
        };
        /** Placement */
        Placement: {
            /** Cable */
            cable: string;
            /** X */
            x: number;
            /** Z */
            z: number;
            /** Enclosure */
            enclosure?: string | null;
        };
        /** PreflightError */
        PreflightError: {
            /**
             * Code
             * @description Stable validation code.
             */
            code: string;
            /**
             * Message
             * @description Human-readable correction.
             */
            message: string;
            /**
             * Path
             * @description RFC 6901 JSON Pointer relative to the domain input; /parameters addresses method parameters. Array indices are zero-based, object keys escape ~ and /. No physical unit.
             */
            path: string;
            /**
             * Issues
             * @description Individual invalid fields, each independently navigable.
             */
            issues?: components["schemas"]["PreflightIssue"][];
        } & {
            [key: string]: unknown;
        };
        /** PreflightIssue */
        PreflightIssue: {
            /**
             * Code
             * @description Stable validation code.
             */
            code: string;
            /**
             * Message
             * @description Human-readable correction.
             */
            message: string;
            /**
             * Path
             * @description RFC 6901 JSON Pointer relative to the domain input; /parameters addresses method parameters. Array indices are zero-based, object keys escape ~ and /. No physical unit.
             */
            path: string;
        } & {
            [key: string]: unknown;
        };
        /** PreflightReport */
        PreflightReport: {
            package: components["schemas"]["StudyPackage"];
            /** Package Sha256 */
            package_sha256: string;
            /**
             * Status
             * @enum {string}
             */
            status: "package_ready" | "blocked";
            /**
             * Native Model Built
             * @default false
             * @constant
             */
            native_model_built?: false;
            /**
             * Solver Executed
             * @default false
             * @constant
             */
            solver_executed?: false;
            /** Issues */
            issues: components["schemas"]["backend__foundation__study__PreflightIssue"][];
        };
        /** PreflightResponse */
        PreflightResponse: {
            /** Ready */
            ready: boolean;
            /** Partial */
            partial: boolean;
            /** Runnable Case Ids */
            runnable_case_ids: string[];
            /** Cases */
            cases: components["schemas"]["CheckCase"][];
            /** Crosschecks */
            crosschecks: components["schemas"]["CheckCase"][];
            /** Method Scopes */
            method_scopes: {
                [key: string]: components["schemas"]["JsonValue"];
            }[];
            /** Limitations */
            limitations: string[];
            /** Validation */
            validation: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /** Lock Digest */
            lock_digest: string;
            /** Input Digest */
            input_digest: string;
        } & {
            [key: string]: unknown;
        };
        /** PreviewProfiling */
        PreviewProfiling: {
            /**
             * Queue Ms
             * @description Host admission and queue time, ms.
             */
            queue_ms: number;
            /**
             * Validation Ms
             * @description Host preparation time, ms.
             */
            validation_ms: number;
            /**
             * Server Ms
             * @description Total server response time, ms; not a solver benchmark.
             */
            server_ms: number;
        };
        /** ProposalRequest */
        ProposalRequest: {
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Extraction Id
             * @description Successfully extracted and completely human-reviewed record.
             */
            extraction_id: string;
            /** Expected Review Revision */
            expected_review_revision: number;
            /**
             * Target Model Id
             * @description Existing immutable cable-model version to branch.
             */
            target_model_id: string;
            /** Expected Model Sha256 */
            expected_model_sha256: string;
            /**
             * Version
             * @description New draft version label; original model remains unchanged.
             */
            version: string;
            /**
             * Field Bindings
             * @description For a complete structural target only: canonical field -> explicit JSON pointer(s) under /cable_type. Matching conductor quantity/layer role and SI unit are required; no geometry inference.
             */
            field_bindings?: {
                [key: string]: string[];
            };
        };
        /** ProposalResponse */
        ProposalResponse: {
            /** Id */
            id: string;
            /** Document Id */
            document_id: string;
            /**
             * Status
             * @enum {string}
             */
            status: "proposed" | "approved";
            /** Sha256 */
            sha256: string;
            /** Target Model Id */
            target_model_id: string;
            /** Base Sha256 */
            base_sha256: string;
            /** @description Proposed immutable new model version; creation happens only after approval. */
            draft: components["schemas"]["CableModelVersion-Output"];
            /**
             * Changes
             * @description Before/after SI values, source evidence and human decisions.
             */
            changes: {
                [key: string]: unknown;
            }[];
            /** New Model Id */
            new_model_id?: string | null;
            /** Approval */
            approval?: {
                [key: string]: unknown;
            } | null;
        };
        /** ProviderCall */
        ProviderCall: {
            /**
             * Operation
             * @enum {string}
             */
            operation: "ocr" | "extraction";
            /**
             * Requested Model
             * @description Pinned model sent in the request.
             */
            requested_model: string;
            /**
             * Returned Model
             * @description Actual model identifier returned by provider.
             */
            returned_model: string;
            /**
             * Elapsed Seconds
             * @description Wall latency in seconds, including HTTP response download.
             */
            elapsed_seconds: number;
            /**
             * Service Seconds
             * @description Optional external HTTP service latency measured by authorized evaluation relay; excludes SSH relay overhead.
             */
            service_seconds?: number | null;
            /**
             * Prompt Tokens
             * @description Provider reported input tokens; zero for page-priced OCR.
             */
            prompt_tokens: number;
            /**
             * Completion Tokens
             * @description Provider reported output tokens.
             */
            completion_tokens: number;
            /**
             * Pages
             * @description Provider reported processed OCR pages.
             */
            pages: number;
            /**
             * Response Sha256
             * @description Digest of raw provider response; raw response bodies are not exposed in logs.
             */
            response_sha256: string;
        };
        /** Publish */
        Publish: {
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Submission Id
             * Format: uuid
             */
            submission_id: string;
            /** Specification Digest */
            specification_digest: string;
        };
        /**
         * PublishedSpecification
         * @description Published facts can be stored without inventing a complete solver model.
         */
        PublishedSpecification: {
            /** Manufacturer */
            manufacturer: string;
            /** Designation */
            designation: string;
            /** Voltage V */
            voltage_v: number;
            /** U0 V */
            u0_v: number;
            /** Cores */
            cores: number;
            /** Area M2 */
            area_m2: number;
            /**
             * Conductor
             * @enum {string}
             */
            conductor: "copper_bare" | "copper_coated" | "aluminium";
            /** Values */
            values: {
                [key: string]: components["schemas"]["PublishedValue"];
            };
            /** Missing */
            missing: string[];
        };
        /** PublishedValue */
        PublishedValue: {
            /** Value */
            value: number;
            /**
             * Unit
             * @enum {string}
             */
            unit: "m" | "m2" | "ohm/m" | "kg/m" | "K" | "1";
            /**
             * Basis
             * @enum {string}
             */
            basis: "manufacturer" | "standard_nominal" | "standard_limit" | "engineer_given";
            /** Source */
            source: string;
        };
        /** Quantity */
        Quantity: {
            /** Value */
            value: number;
            /** Unit */
            unit: string;
            /**
             * Dimension
             * @enum {string}
             */
            dimension: "length" | "area" | "absolute_temperature" | "temperature_difference" | "linear_resistance" | "thermal_resistivity" | "thermal_conductivity" | "current" | "frequency";
        };
        /** Rating */
        Rating: {
            /** U0 */
            u0: number;
            /** U */
            u?: number | null;
            /** Um */
            um?: number | null;
            /** Max Conductor Temperature */
            max_conductor_temperature: {
                [key: string]: number;
            };
        };
        /** RatingRow */
        RatingRow: {
            /** Case Id */
            case_id: string;
            /** Name */
            name: string;
            /**
             * Layout
             * @enum {string}
             */
            layout: "trefoil" | "flat" | "ducts" | "air";
            /**
             * Depth M
             * @default 0.8
             */
            depth_m?: number;
            /**
             * Soil Rho K M W
             * @default 1
             */
            soil_rho_k_m_w?: number;
            /**
             * Ambient Temperature C
             * @default 20
             */
            ambient_temperature_c?: number;
            /** Spacing M */
            spacing_m?: number | null;
            /**
             * Bonding
             * @default both_ends
             * @enum {string}
             */
            bonding?: "both_ends" | "single_point" | "unspecified";
            /**
             * Duct Inner M
             * @default 0.14
             */
            duct_inner_m?: number;
            /**
             * Duct Outer M
             * @default 0.16
             */
            duct_outer_m?: number;
            /**
             * Duct Rho K M W
             * @default 6
             */
            duct_rho_k_m_w?: number;
            /**
             * Source
             * @default 典型工况模板；明示设计条件，非现场测量
             */
            source?: string;
        };
        /** RatingTableDefinition */
        RatingTableDefinition: {
            /** Expected Revision */
            expected_revision: number;
            /** Rows */
            rows: components["schemas"]["RatingRow"][];
            /** Parameters */
            parameters?: {
                [key: string]: unknown;
            };
            /** Selected Case Ids */
            selected_case_ids?: string[] | null;
        };
        /** ReleasePin */
        ReleasePin: {
            /**
             * Plugin Id
             * @description Used plugin identity; capability is bound by the preview request.
             */
            plugin_id: string;
            /**
             * Version
             * @description Exact used version.
             */
            version: string;
            /**
             * Release Digest
             * @description Used sealed manifest SHA256.
             */
            release_digest: string;
        };
        /** ResistivityLaw */
        ResistivityLaw: {
            /** Reference Temperature K */
            reference_temperature_k: number;
            /** Alpha Per K */
            alpha_per_k: number;
            /** Minimum Temperature K */
            minimum_temperature_k: number;
            /** Maximum Temperature K */
            maximum_temperature_k: number;
            /** Source */
            source: string;
        };
        /** ResumeDataset */
        ResumeDataset: {
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Retry Failed
             * @default false
             */
            retry_failed?: boolean;
        };
        /** ReviewRequest */
        ReviewRequest: {
            /**
             * Expected Revision
             * @description CAS revision of extraction review; stale reviews are rejected.
             */
            expected_revision: number;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Reviewer
             * @description Local human operator name; this deployment is not multiuser identity authentication.
             */
            reviewer: string;
            /**
             * Decisions
             * @description Explicit individual accept/modify/reject decisions; no automatic approval.
             */
            decisions: components["schemas"]["Decision"][];
        };
        /** ReviewRequirements */
        ReviewRequirements: {
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Run Id
             * Format: uuid
             */
            run_id: string;
            /** Row Ids */
            row_ids: string[];
            /** Expected Workspace Revision */
            expected_workspace_revision: number;
            /** Expected Requirements Revision */
            expected_requirements_revision: number;
            /** Reviewer */
            reviewer: string;
            /**
             * Human Confirmed
             * @constant
             */
            human_confirmed: true;
        };
        /** Revision */
        Revision: {
            /** Expected Revision */
            expected_revision: number;
        };
        /** RunPage */
        RunPage: {
            /** Items */
            items: components["schemas"]["RunResponse"][];
            /** Next Cursor */
            next_cursor: number | null;
        } & {
            [key: string]: unknown;
        };
        /** RunResponse */
        RunResponse: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Workspace
             * Format: uuid
             */
            workspace: string;
            /**
             * Study
             * Format: uuid
             */
            study: string;
            /** Sequence */
            sequence: number;
            /**
             * Request Id
             * Format: uuid
             * @description Idempotency identity; repeated clicks reuse this exact run.
             */
            request_id: string;
            /** Request Digest */
            request_digest: string;
            /**
             * Input Digest
             * @description SHA256 of immutable accepted snapshot.
             */
            input_digest: string;
            /**
             * Snapshot
             * @description Saved domain/SI input, selected module, exact method, parameters and source bindings.
             */
            snapshot: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /**
             * Status
             * @enum {string}
             */
            status: "accepted" | "running" | "validating" | "succeeded" | "partial" | "failed" | "interrupted";
            /**
             * Output
             * @description Saved typed quantities and verified artifacts; absent while running.
             */
            output: {
                [key: string]: components["schemas"]["JsonValue"];
            } | null;
            /** Output Digest */
            output_digest: string | null;
            /** Error */
            error: {
                [key: string]: components["schemas"]["JsonValue"];
            } | null;
            /** Created */
            created: string;
            /** Finished */
            finished: string | null;
            /**
             * Integrity
             * @enum {string}
             */
            integrity: "verified" | "corrupt";
            /**
             * Freshness
             * @enum {string}
             */
            freshness: "current" | "historical" | "unknown";
            /**
             * Artifact Status
             * @description Presentation contract verification by case and artifact type.
             */
            artifact_status?: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /**
             * Owner Epoch
             * @description Host owner epoch at admission; not an authentication token.
             */
            owner_epoch: string;
            /**
             * Execution Nonce
             * @description Internal attempt identity; does not authorize execution.
             */
            execution_nonce: string;
            /**
             * Method Availability
             * @description Availability of the exact saved method release.
             */
            method_availability?: {
                [key: string]: components["schemas"]["JsonValue"];
            } | null;
            /**
             * Convergence
             * @description Saved mesh/domain convergence gate; unconverged fields cannot enter a calculation book.
             */
            convergence?: {
                [key: string]: components["schemas"]["JsonValue"];
            } | null;
        } & {
            [key: string]: unknown;
        };
        /** RunStudy */
        RunStudy: {
            /** Module */
            module?: string | null;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /** Expected Revision */
            expected_revision: number;
            /** Expected Study Revision */
            expected_study_revision: number;
            /** Lock Digest */
            lock_digest: string;
            /**
             * Scope Acknowledged
             * @constant
             */
            scope_acknowledged: true;
        };
        /** Sample */
        Sample: {
            /** Label */
            label: string;
            /** Changes */
            changes?: {
                [key: string]: number;
            };
        };
        /** SaveConfiguration */
        SaveConfiguration: {
            /** Source Module */
            source_module?: string | null;
            parameter_space: components["schemas"]["ParameterSpace"];
            execution?: components["schemas"]["Execution"];
            /** Expected Revision */
            expected_revision: number;
            /** Expected Study Revision */
            expected_study_revision: number;
            /** Expected Configuration Revision */
            expected_configuration_revision: number;
        };
        /** SaveDomain */
        SaveDomain: {
            /** Expected Revision */
            expected_revision: number;
            document: components["schemas"]["DomainDocument-Input"];
        };
        /** Scenario */
        Scenario: {
            /**
             * Schema Version
             * @default 1
             * @constant
             */
            schema_version?: 1;
            /**
             * Name
             * @default 中压馈线 · 方案 01
             */
            name?: string;
            /**
             * Description
             * @default 单回路 / 均匀土壤 / 稳态负荷
             */
            description?: string;
            cable?: components["schemas"]["Cable"];
            installation?: components["schemas"]["Installation"];
            /**
             * Operating Current A
             * @default 350
             */
            operating_current_a?: number;
            /**
             * Circuit Length M
             * @default 1000
             */
            circuit_length_m?: number;
        };
        /** Section */
        "Section-Input": {
            /** Id */
            id: string;
            /** Label */
            label: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "ground" | "air" | "tunnel" | "shaft";
            /** Length */
            length: number;
            medium: components["schemas"]["Medium"];
            /** Enclosures */
            enclosures?: components["schemas"]["Enclosure"][];
            /** Placements */
            placements: components["schemas"]["Placement"][];
            /** Layout Template */
            layout_template?: {
                [key: string]: unknown;
            };
            backfill?: components["schemas"]["Backfill"] | null;
            /** Soil Layers */
            soil_layers?: components["schemas"]["SoilLayer"][];
        };
        /** Section */
        "Section-Output": {
            /** Id */
            id: string;
            /** Label */
            label: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "ground" | "air" | "tunnel" | "shaft";
            /** Length */
            length: number;
            medium: components["schemas"]["Medium"];
            /** Enclosures */
            enclosures?: components["schemas"]["Enclosure"][];
            /** Placements */
            placements: components["schemas"]["Placement"][];
            /** Layout Template */
            layout_template?: {
                [key: string]: unknown;
            };
            backfill?: components["schemas"]["Backfill"] | null;
            /** Soil Layers */
            soil_layers?: components["schemas"]["SoilLayer"][];
        };
        /** SelectedModel */
        SelectedModel: {
            /**
             * Designation
             * @description Explicit selected model/family printed in the source, such as YJLW03.
             */
            designation: string;
            /**
             * Specification
             * @description Exact selected row/column label, such as 240 or 3×300; never inferred from another row.
             */
            specification: string;
            /**
             * Identity Note
             * @description Human-selected voltage, conductor, sheath variant and manufacturer context.
             */
            identity_note: string;
        };
        /** Selection */
        Selection: {
            /**
             * Page
             * @description Selected 1-based original PDF page.
             */
            page: number;
            /**
             * Region
             * @description Optional [left,top,right,bottom] in PDF points; top-left origin, y down.
             */
            region?: number[] | null;
        };
        /** Series */
        Series: {
            /** Time */
            time: number[];
            /** Value */
            value: number[];
            /**
             * Interpolation
             * @enum {string}
             */
            interpolation: "step" | "linear";
            /**
             * Scale
             * @enum {string}
             */
            scale: "absolute" | "per_unit";
        };
        /** SheathLossParameters */
        "SheathLossParameters-Input": {
            electromagnetic_options: components["schemas"]["ElectromagneticDomainOptions"];
            /** @description Native field mesh lengths m, node limit and order. */
            mesh: components["schemas"]["MeshControls"];
            /** @description Explicit native temperature tensor, °C axes and dimensionless current scale; no extrapolation. */
            temperature_table?: components["schemas"]["LossTemperatureTable"] | null;
        };
        /** SheathLossParameters */
        "SheathLossParameters-Output": {
            electromagnetic_options: components["schemas"]["ElectromagneticDomainOptions"];
            /** @description Native field mesh lengths m, node limit and order. */
            mesh: components["schemas"]["MeshControls"];
            /** @description Explicit native temperature tensor, °C axes and dimensionless current scale; no extrapolation. */
            temperature_table?: components["schemas"]["LossTemperatureTable"] | null;
        };
        /** SoilLayer */
        SoilLayer: {
            /** Id */
            id: string;
            /** Label */
            label: string;
            /** Material */
            material: string;
            /** Top Z */
            top_z: number;
            /** Bottom Z */
            bottom_z: number;
        };
        /** Source */
        Source: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "demo" | "user" | "manufacturer" | "standard" | "measurement" | "derived" | "asset";
            /** Reference */
            reference?: string | null;
            /**
             * Reviewed
             * @default false
             */
            reviewed?: boolean;
        };
        /** SourceReference */
        SourceReference: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "manufacturer" | "standard" | "project_input" | "derived";
            /** Reference */
            reference: string;
            /** Reviewed */
            reviewed: boolean;
        };
        /** StudyConfiguration */
        "StudyConfiguration-Input": {
            /** Title */
            title: string;
            /**
             * Task
             * @description Study objective; simulation tasks submit asynchronously to Slurm.
             */
            task?: ("rating" | "operating" | "target" | "transient-temperature" | "sheath-losses" | "electrothermal-steady") | null;
            method: components["schemas"]["Method"];
            /**
             * Input Source
             * @default domain
             * @enum {string}
             */
            input_source?: "domain" | "study";
            /** Method Input */
            method_input?: {
                [key: string]: unknown;
            } | null;
            /**
             * Parameters
             * @description Saved capability parameters. Simulation task models are exposed in OpenAPI; other plugins use GET /api/input-contracts parameter_schema. SI lengths m, time s, temperature K, RMS current A.
             */
            parameters?: {
                [key: string]: unknown;
            } | components["schemas"]["TransientParameters-Input"] | components["schemas"]["SheathLossParameters-Input"] | components["schemas"]["CoupledParameters-Input"];
            /** Input Sources */
            input_sources?: {
                [key: string]: components["schemas"]["Source"];
            };
            /** Candidate Completions */
            candidate_completions?: {
                [key: string]: components["schemas"]["CandidateCompletion"];
            };
            driver?: components["schemas"]["Driver"];
            /** Crosschecks */
            crosschecks?: components["schemas"]["CrosscheckMethod"][];
            verification?: components["schemas"]["ThermalConvergence"] | null;
        };
        /** StudyConfiguration */
        "StudyConfiguration-Output": {
            /** Title */
            title: string;
            /**
             * Task
             * @description Study objective; simulation tasks submit asynchronously to Slurm.
             */
            task?: ("rating" | "operating" | "target" | "transient-temperature" | "sheath-losses" | "electrothermal-steady") | null;
            method: components["schemas"]["Method"];
            /**
             * Input Source
             * @default domain
             * @enum {string}
             */
            input_source?: "domain" | "study";
            /** Method Input */
            method_input?: {
                [key: string]: unknown;
            } | null;
            /**
             * Parameters
             * @description Saved capability parameters. Simulation task models are exposed in OpenAPI; other plugins use GET /api/input-contracts parameter_schema. SI lengths m, time s, temperature K, RMS current A.
             */
            parameters?: {
                [key: string]: unknown;
            } | components["schemas"]["TransientParameters-Output"] | components["schemas"]["SheathLossParameters-Output"] | components["schemas"]["CoupledParameters-Output"];
            /** Input Sources */
            input_sources?: {
                [key: string]: components["schemas"]["Source"];
            };
            /** Candidate Completions */
            candidate_completions?: {
                [key: string]: components["schemas"]["CandidateCompletion"];
            };
            driver?: components["schemas"]["Driver"];
            /** Crosschecks */
            crosschecks?: components["schemas"]["CrosscheckMethod"][];
            verification?: components["schemas"]["ThermalConvergence"] | null;
        };
        /** StudyDefinition */
        StudyDefinition: {
            /** Title */
            title: string;
            /**
             * Task
             * @description Study objective; simulation tasks submit asynchronously to Slurm.
             */
            task?: ("rating" | "operating" | "target" | "transient-temperature" | "sheath-losses" | "electrothermal-steady") | null;
            method: components["schemas"]["Method"];
            /**
             * Input Source
             * @default domain
             * @enum {string}
             */
            input_source?: "domain" | "study";
            /** Method Input */
            method_input?: {
                [key: string]: unknown;
            } | null;
            /**
             * Parameters
             * @description Saved capability parameters. Simulation task models are exposed in OpenAPI; other plugins use GET /api/input-contracts parameter_schema. SI lengths m, time s, temperature K, RMS current A.
             */
            parameters?: {
                [key: string]: unknown;
            } | components["schemas"]["TransientParameters-Output"] | components["schemas"]["SheathLossParameters-Output"] | components["schemas"]["CoupledParameters-Output"];
            /** Input Sources */
            input_sources?: {
                [key: string]: components["schemas"]["Source"];
            };
            /** Candidate Completions */
            candidate_completions?: {
                [key: string]: components["schemas"]["CandidateCompletion"];
            };
            driver?: components["schemas"]["Driver"];
            /** Crosschecks */
            crosschecks?: components["schemas"]["CrosscheckMethod"][];
            verification?: components["schemas"]["ThermalConvergence"] | null;
            /**
             * Modules
             * @description Independently configured study modules; each freezes its own method and parameters at run acceptance.
             */
            modules?: {
                [key: string]: components["schemas"]["StudyConfiguration-Output"];
            };
        };
        /** StudyPackage */
        StudyPackage: {
            /**
             * Schema Version
             * @default csp-study/0.1
             * @constant
             */
            schema_version?: "csp-study/0.1";
            /** Project Id */
            project_id: string;
            /** Scenario Revision */
            scenario_revision: number;
            /**
             * Adapter Version
             * @default study-contract/0.1.0
             * @constant
             */
            adapter_version?: "study-contract/0.1.0";
            /**
             * Target
             * @enum {string}
             */
            target: "schema" | "comsol" | "aedt";
            /**
             * Mode
             * @default build_only
             * @constant
             */
            mode?: "build_only";
            /**
             * Source Kind
             * @default project_input_snapshot
             * @constant
             */
            source_kind?: "project_input_snapshot";
            /** Source Sha256 */
            source_sha256: string;
            /**
             * Asset Lock
             * @default []
             */
            asset_lock?: components["schemas"]["AssetRef"][];
            geometry_recipe: components["schemas"]["CircularRecipe"];
            ambient_temperature: components["schemas"]["Quantity"];
            conductor_limit: components["schemas"]["Quantity"];
            operating_current: components["schemas"]["Quantity"];
            conductor_r20: components["schemas"]["Quantity"] | null;
            /**
             * Requested Outputs
             * @default [
             *       "geometry_recipe",
             *       "preflight_issues"
             *     ]
             */
            requested_outputs?: ("geometry_recipe" | "preflight_issues")[];
        };
        /** StudyResponse */
        StudyResponse: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Workspace
             * Format: uuid
             */
            workspace: string;
            /**
             * Revision
             * @description Study configuration revision.
             */
            revision: number;
            definition: components["schemas"]["StudyDefinition"];
            /**
             * Created
             * @description UTC configuration timestamp.
             */
            created: string;
        } & {
            [key: string]: unknown;
        };
        /** Submit */
        Submit: {
            /** Expected Revision */
            expected_revision: number;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /** Specification Digest */
            specification_digest: string;
            /** Acknowledge Checks */
            acknowledge_checks: boolean;
        };
        /** SubmitDataset */
        SubmitDataset: {
            /** Module */
            module?: string | null;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /** Expected Revision */
            expected_revision: number;
            /** Expected Study Revision */
            expected_study_revision: number;
            /** Lock Digest */
            lock_digest: string;
            /**
             * Scope Acknowledged
             * @constant
             */
            scope_acknowledged: true;
            /** Configuration Revision */
            configuration_revision: number;
        };
        /** System */
        System: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "ac_three_phase" | "ac_single_phase" | "dc";
            /** Frequency */
            frequency: number;
            /**
             * Voltage
             * @description 系统线电压 / V；未知时为 null，不从电缆 U0 推断
             */
            voltage?: number | null;
        };
        /** TaskOption */
        TaskOption: {
            /** Task */
            task: string;
            /** Module */
            module: string;
            /** Label */
            label: string;
            method: components["schemas"]["Method"];
            /** Analysis */
            analysis: string;
            /** Required Artifacts */
            required_artifacts: string[];
            /**
             * Execution Backend
             * @enum {string}
             */
            execution_backend: "local" | "slurm";
            /** Input Contract Url */
            input_contract_url: string;
            /**
             * Parameters Unit System
             * @constant
             */
            parameters_unit_system: "SI";
            /** Limitations */
            limitations: string[];
        } & {
            [key: string]: unknown;
        };
        /** TextCell */
        TextCell: {
            /** Text */
            text: string;
            /**
             * Bbox
             * @description PDF points; top-left origin, y down.
             */
            bbox: number[];
        };
        /** ThermalBoundary */
        ThermalBoundary: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "temperature" | "convection" | "insulated";
            /**
             * Temperature K
             * @description Boundary absolute temperature K, null only where the selected kind permits.
             */
            temperature_k: number | null;
            /**
             * H W M2 K
             * @description Convective heat transfer coefficient W/(m²*K).
             */
            h_w_m2_k?: number | null;
            /**
             * Emissivity
             * @description Dimensionless emissivity; plugin validates whether radiation is supported.
             */
            emissivity?: number | null;
        };
        /** ThermalConvergence */
        ThermalConvergence: {
            /**
             * Kind
             * @default temperature-field
             * @constant
             */
            kind?: "temperature-field";
            /** Mesh Case Ids */
            mesh_case_ids: string[];
            /** Domain Case Id */
            domain_case_id: string;
            /**
             * Tolerance K
             * @default 0.1
             */
            tolerance_k?: number;
        };
        /** ThermalDomainOptions */
        "ThermalDomainOptions-Input": {
            /**
             * Section Id
             * @description Existing saved domain section identity.
             */
            section_id: string;
            /**
             * Load Id
             * @description Existing saved time-series/cyclic/emergency load identity.
             */
            load_id: string;
            /**
             * Bounds M
             * @description Finite x0,z0,x1,z1 bounds in m; null for an explicitly supported intrinsic boundary.
             */
            bounds_m: [
                number,
                number,
                number,
                number
            ] | null;
            /**
             * Boundaries
             * @description Boundary selectors supported by the saved section; temperatures K.
             */
            boundaries: {
                [key: string]: components["schemas"]["ThermalBoundary"];
            };
            /**
             * Per Cable
             * @description Complete thermal source settings indexed by each placed cable UID.
             */
            per_cable: {
                [key: string]: components["schemas"]["CableHeatOptions"];
            };
            /**
             * Duct Air
             * @description One equivalent air resistance/source per saved duct UID.
             */
            duct_air: {
                [key: string]: components["schemas"]["DuctAirResistance"];
            };
            /**
             * Source
             * @description Engineering source of the complete boundary/source assumptions.
             */
            source: string;
        };
        /** ThermalDomainOptions */
        "ThermalDomainOptions-Output": {
            /**
             * Section Id
             * @description Existing saved domain section identity.
             */
            section_id: string;
            /**
             * Load Id
             * @description Existing saved time-series/cyclic/emergency load identity.
             */
            load_id: string;
            /**
             * Bounds M
             * @description Finite x0,z0,x1,z1 bounds in m; null for an explicitly supported intrinsic boundary.
             */
            bounds_m: [
                number,
                number,
                number,
                number
            ] | null;
            /**
             * Boundaries
             * @description Boundary selectors supported by the saved section; temperatures K.
             */
            boundaries: {
                [key: string]: components["schemas"]["ThermalBoundary"];
            };
            /**
             * Per Cable
             * @description Complete thermal source settings indexed by each placed cable UID.
             */
            per_cable: {
                [key: string]: components["schemas"]["CableHeatOptions"];
            };
            /**
             * Duct Air
             * @description One equivalent air resistance/source per saved duct UID.
             */
            duct_air: {
                [key: string]: components["schemas"]["DuctAirResistance"];
            };
            /**
             * Source
             * @description Engineering source of the complete boundary/source assumptions.
             */
            source: string;
        };
        /** Time */
        Time: {
            /** Initial Temperature K */
            initial_temperature_k: number;
            /** Step S */
            step_s: number;
            /** Steps */
            steps: number;
            /**
             * Bdf Order
             * @default 1
             * @enum {integer}
             */
            bdf_order?: 1 | 2;
        };
        /** TransientParameters */
        "TransientParameters-Input": {
            domain_options: components["schemas"]["ThermalDomainOptions-Input"];
            /** @description Initial temperature K, time step s, step count and BDF order. */
            time: components["schemas"]["Time"];
            /** @description Mesh lengths m, explicit node limit; P1 transient elements. */
            mesh: components["schemas"]["MeshControls"];
            /**
             * Resistance Temperature K
             * @description Frozen resistance temperature by cable UID, absolute K.
             */
            resistance_temperature_k: {
                [key: string]: number;
            };
            /** Duct Air Capacity */
            duct_air_capacity?: {
                [key: string]: components["schemas"]["AirHeatCapacity"];
            };
        };
        /** TransientParameters */
        "TransientParameters-Output": {
            domain_options: components["schemas"]["ThermalDomainOptions-Output"];
            /** @description Initial temperature K, time step s, step count and BDF order. */
            time: components["schemas"]["Time"];
            /** @description Mesh lengths m, explicit node limit; P1 transient elements. */
            mesh: components["schemas"]["MeshControls"];
            /**
             * Resistance Temperature K
             * @description Frozen resistance temperature by cable UID, absolute K.
             */
            resistance_temperature_k: {
                [key: string]: number;
            };
            /** Duct Air Capacity */
            duct_air_capacity?: {
                [key: string]: components["schemas"]["AirHeatCapacity"];
            };
        };
        /** TransitionAsset */
        TransitionAsset: {
            /** Expected Revision */
            expected_revision: number;
            /** Content Sha256 */
            content_sha256: string;
            /**
             * Action
             * @enum {string}
             */
            action: "review" | "publish" | "return_to_draft" | "deprecate";
            /** Note */
            note: string;
            /**
             * Acknowledge Sources
             * @default false
             */
            acknowledge_sources?: boolean;
        };
        /** UpdateStudy */
        UpdateStudy: {
            /** Title */
            title: string;
            /**
             * Task
             * @description Study objective; simulation tasks submit asynchronously to Slurm.
             */
            task?: ("rating" | "operating" | "target" | "transient-temperature" | "sheath-losses" | "electrothermal-steady") | null;
            method: components["schemas"]["Method"];
            /**
             * Input Source
             * @default domain
             * @enum {string}
             */
            input_source?: "domain" | "study";
            /** Method Input */
            method_input?: {
                [key: string]: unknown;
            } | null;
            /**
             * Parameters
             * @description Saved capability parameters. Simulation task models are exposed in OpenAPI; other plugins use GET /api/input-contracts parameter_schema. SI lengths m, time s, temperature K, RMS current A.
             */
            parameters?: {
                [key: string]: unknown;
            } | components["schemas"]["TransientParameters-Input"] | components["schemas"]["SheathLossParameters-Input"] | components["schemas"]["CoupledParameters-Input"];
            /** Input Sources */
            input_sources?: {
                [key: string]: components["schemas"]["Source"];
            };
            /** Candidate Completions */
            candidate_completions?: {
                [key: string]: components["schemas"]["CandidateCompletion"];
            };
            driver?: components["schemas"]["Driver"];
            /** Crosschecks */
            crosschecks?: components["schemas"]["CrosscheckMethod"][];
            verification?: components["schemas"]["ThermalConvergence"] | null;
            /**
             * Modules
             * @description Independently configured study modules; each freezes its own method and parameters at run acceptance.
             */
            modules?: {
                [key: string]: components["schemas"]["StudyConfiguration-Input"];
            };
            /** Expected Revision */
            expected_revision: number;
            /** Expected Study Revision */
            expected_study_revision: number;
        };
        /** ValidationError */
        ValidationError: {
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
            /** Input */
            input?: unknown;
            /** Context */
            ctx?: Record<string, never>;
        };
        /** PreflightIssue */
        backend__foundation__study__PreflightIssue: {
            /** Code */
            code: string;
            /**
             * Severity
             * @enum {string}
             */
            severity: "error" | "warning" | "info";
            /** Object Path */
            object_path: string;
            /** Message */
            message: string;
            /** Remediation */
            remediation: string;
        };
        CableModelVersion: components["schemas"]["CableModelVersion-Input"];
        CableType: components["schemas"]["CableType-Input"];
        Circuit: components["schemas"]["Circuit-Input"];
        CoupledParameters: components["schemas"]["CoupledParameters-Input"];
        DomainDocument: components["schemas"]["DomainDocument-Input"];
        Section: components["schemas"]["Section-Input"];
        SheathLossParameters: components["schemas"]["SheathLossParameters-Input"];
        StudyConfiguration: components["schemas"]["StudyConfiguration-Input"];
        ThermalDomainOptions: components["schemas"]["ThermalDomainOptions-Input"];
        TransientParameters: components["schemas"]["TransientParameters-Input"];
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    listing_api_workspaces_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    create_api_workspaces_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Create"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_api_workspaces__wid__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    restore_session_api_workspaces__wid__session_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    edit_api_workspaces__wid__edit_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Edit"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    lock_api_workspaces__wid__lock_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Lock"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    history_api_workspaces__wid__history__direction__post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                direction: "undo" | "redo";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Revision"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_run_api_workspaces__wid__runs__rid__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                rid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    capabilities_api_foundation_capabilities_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    preflight_api_foundation_workspaces__wid__preflight_get: {
        parameters: {
            query: {
                expected_revision: number;
                target?: "schema" | "comsol" | "aedt";
            };
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreflightReport"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_assets_api_foundation_assets_get: {
        parameters: {
            query?: {
                kind?: ("material" | "component" | "assembly" | "installation" | "study_template" | "rule") | null;
                status?: ("draft" | "reviewed" | "published" | "deprecated") | null;
                q?: string;
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    import_asset_api_foundation_assets_import_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportAsset"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    asset_detail_api_foundation_assets__rid__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                rid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    edit_asset_api_foundation_assets__rid__put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                rid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EditAsset"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    transition_asset_api_foundation_assets__rid__transition_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                rid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TransitionAsset"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    derive_asset_api_foundation_assets__rid__derive_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                rid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeriveAsset"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    capture_asset_api_foundation_workspaces__wid__assets_capture_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CaptureAsset"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    catalog_api_foundation_reproductions_get: {
        parameters: {
            query?: {
                snapshot?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    detail_api_foundation_reproductions__target_id__get: {
        parameters: {
            query?: {
                snapshot?: string | null;
            };
            header?: never;
            path: {
                target_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    export_api_foundation_reproductions__target_id__export_get: {
        parameters: {
            query?: {
                snapshot?: string | null;
            };
            header?: never;
            path: {
                target_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    methods_api_methods_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    tasks_api_study_tasks_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskOption"][];
                };
            };
        };
    };
    model_artifacts_api_model_artifacts_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    measurement_input_contract_api_measurement_input_contract_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    revisions_api_workspaces__wid__revisions_get: {
        parameters: {
            query?: {
                after?: number;
                limit?: number;
            };
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    revision_api_workspaces__wid__revisions__revision__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                revision: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    studies_api_workspaces__wid__studies_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StudyResponse"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_api_workspaces__wid__studies_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateStudy"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StudyResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_api_workspaces__wid__studies__sid__put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                sid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateStudy"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StudyResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    preflight_api_workspaces__wid__studies__sid__preflight_get: {
        parameters: {
            query: {
                expected_revision: number;
                expected_study_revision: number;
                module?: string | null;
            };
            header?: never;
            path: {
                wid: string;
                sid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreflightResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    runs_api_workspaces__wid__studies__sid__runs_get: {
        parameters: {
            query?: {
                after?: number;
                limit?: number;
            };
            header?: never;
            path: {
                wid: string;
                sid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunPage"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    execute_api_workspaces__wid__studies__sid__runs_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                sid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RunStudy"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunResponse"];
                };
            };
            /** @description Accepted asynchronous simulation; poll the Location URL. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    run_api_workspaces__wid__studies__sid__runs__rid__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                sid: string;
                rid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    resume_api_workspaces__wid__studies__sid__runs__rid__resume_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                sid: string;
                rid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    comparison_api_workspaces__wid__study_comparisons_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Comparison"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    deliver_api_workspaces__wid__deliveries_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeliveryRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delivery_api_workspaces__wid__deliveries__did__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                did: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    geometry_preview_api_workspaces__wid__geometry_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GeometryPreview"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GeometryPreviewResult"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unprocessable Entity */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    geometry_preview_api_design_workspaces__wid__geometry_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GeometryPreview"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GeometryPreviewResult"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unprocessable Entity */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    input_contracts_api_input_contracts_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InputContract"][];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unprocessable Entity */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    input_contracts_api_design_input_contracts_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InputContract"][];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unprocessable Entity */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    iec_example_api_examples_iec_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IecExample"];
                };
            };
        };
    };
    iec_example_api_design_examples_iec_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IecExample"];
                };
            };
        };
    };
    cable_example_api_examples_cable_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CableExample"];
                };
            };
        };
    };
    cable_example_api_design_examples_cable_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CableExample"];
                };
            };
        };
    };
    current_delivery_api_workspaces__wid__deliveries_current_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CurrentDeliveryRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeliveryResult"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unprocessable Entity */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    current_delivery_api_design_workspaces__wid__deliveries_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CurrentDeliveryRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeliveryResult"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unprocessable Entity */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    delivery_file_api_workspaces__wid__deliveries__did__file_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                did: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Integrity-checked saved HTML attachment. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/html": string;
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unprocessable Entity */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    delivery_file_api_design_workspaces__wid__deliveries__did__file_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                did: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Integrity-checked saved HTML attachment. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/html": string;
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unprocessable Entity */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    configuration_api_workspaces__wid__studies__sid__batch_configuration_get: {
        parameters: {
            query?: {
                module?: string | null;
            };
            header?: never;
            path: {
                wid: string;
                sid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    save_api_workspaces__wid__studies__sid__batch_configuration_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                sid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveConfiguration"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    preflight_api_workspaces__wid__studies__sid__batch_preflight_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                sid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubmitDataset"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    listing_api_workspaces__wid__studies__sid__datasets_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                sid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    submit_api_workspaces__wid__studies__sid__datasets_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                sid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubmitDataset"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_api_workspaces__wid__studies__sid__datasets__batch_id__get: {
        parameters: {
            query?: {
                offset?: number;
                limit?: number;
                status?: string | null;
            };
            header?: never;
            path: {
                wid: string;
                sid: string;
                batch_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    resume_api_workspaces__wid__studies__sid__datasets__batch_id__resume_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                sid: string;
                batch_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResumeDataset"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    export_api_workspaces__wid__studies__sid__datasets__batch_id__export_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                sid: string;
                batch_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    catalogue_api_domain_cable_models_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    create_api_domain_cable_models_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CableModelVersion-Input"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    discard_api_domain_cable_models__cid__delete: {
        parameters: {
            query: {
                expected_digest: string;
            };
            header?: never;
            path: {
                cid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    catalogue_api_documents_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentResponse"][];
                };
            };
        };
    };
    upload_api_documents_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_api_documents_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentResponse"];
                };
            };
            /** @description Original/run/proposal not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Revision/idempotency/consent conflict. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description PDF exceeds 64 MiB. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Specific field, PDF format, unit or review error. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"] | components["schemas"]["InputFieldErrorResponse"];
                };
            };
            /** @description Extraction queue full; original preserved. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin result rejected. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider or plugin environment missing. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin timeout; original preserved. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
        };
    };
    detail_api_documents__did__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                did: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentResponse"];
                };
            };
            /** @description Original/run/proposal not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Revision/idempotency/consent conflict. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Specific field, PDF format, unit or review error. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"] | components["schemas"]["InputFieldErrorResponse"];
                };
            };
            /** @description Extraction queue full; original preserved. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin result rejected. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider or plugin environment missing. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin timeout; original preserved. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
        };
    };
    original_api_documents__did__file_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                did: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Exact original bytes with X-Original-SHA256 header. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/pdf": unknown;
                };
            };
            /** @description Original/run/proposal not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Revision/idempotency/consent conflict. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Specific field, PDF format, unit or review error. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"] | components["schemas"]["InputFieldErrorResponse"];
                };
            };
            /** @description Extraction queue full; original preserved. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin result rejected. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider or plugin environment missing. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin timeout; original preserved. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
        };
    };
    page_api_documents__did__pages__page__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                did: string;
                page: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PageResponse"];
                };
            };
            /** @description Original/run/proposal not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Revision/idempotency/consent conflict. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Specific field, PDF format, unit or review error. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"] | components["schemas"]["InputFieldErrorResponse"];
                };
            };
            /** @description Extraction queue full; original preserved. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin result rejected. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider or plugin environment missing. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin timeout; original preserved. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
        };
    };
    image_api_documents__did__pages__page__image_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                did: string;
                page: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Page PNG for source-coordinate review; original preserved. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/png": unknown;
                };
            };
            /** @description Original/run/proposal not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Revision/idempotency/consent conflict. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Specific field, PDF format, unit or review error. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"] | components["schemas"]["InputFieldErrorResponse"];
                };
            };
            /** @description Extraction queue full; original preserved. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin result rejected. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider or plugin environment missing. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin timeout; original preserved. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
        };
    };
    disclose_api_documents__did__disclosures_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                did: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExtractionScope"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DisclosureResponse"];
                };
            };
            /** @description Original/run/proposal not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Revision/idempotency/consent conflict. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Specific field, PDF format, unit or review error. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"] | components["schemas"]["InputFieldErrorResponse"];
                };
            };
            /** @description Extraction queue full; original preserved. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin result rejected. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider or plugin environment missing. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin timeout; original preserved. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
        };
    };
    history_api_documents__did__extractions_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                did: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExtractionResponse"][];
                };
            };
            /** @description Original/run/proposal not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Revision/idempotency/consent conflict. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Specific field, PDF format, unit or review error. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"] | components["schemas"]["InputFieldErrorResponse"];
                };
            };
            /** @description Extraction queue full; original preserved. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin result rejected. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider or plugin environment missing. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin timeout; original preserved. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
        };
    };
    extract_api_documents__did__extractions_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                did: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExtractionRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExtractionResponse"];
                };
            };
            /** @description Original/run/proposal not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Revision/idempotency/consent conflict. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Specific field, PDF format, unit or review error. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"] | components["schemas"]["InputFieldErrorResponse"];
                };
            };
            /** @description Extraction queue full; original preserved. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin result rejected. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider or plugin environment missing. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin timeout; original preserved. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
        };
    };
    extraction_api_documents__did__extractions__eid__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                did: string;
                eid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExtractionResponse"];
                };
            };
            /** @description Original/run/proposal not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Revision/idempotency/consent conflict. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Specific field, PDF format, unit or review error. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"] | components["schemas"]["InputFieldErrorResponse"];
                };
            };
            /** @description Extraction queue full; original preserved. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin result rejected. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider or plugin environment missing. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin timeout; original preserved. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
        };
    };
    review_api_documents__did__extractions__eid__reviews_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                did: string;
                eid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReviewRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExtractionResponse"];
                };
            };
            /** @description Original/run/proposal not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Revision/idempotency/consent conflict. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Specific field, PDF format, unit or review error. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"] | components["schemas"]["InputFieldErrorResponse"];
                };
            };
            /** @description Extraction queue full; original preserved. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin result rejected. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider or plugin environment missing. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin timeout; original preserved. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
        };
    };
    propose_api_documents__did__proposals_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                did: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProposalRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProposalResponse"];
                };
            };
            /** @description Original/run/proposal not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Revision/idempotency/consent conflict. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Specific field, PDF format, unit or review error. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"] | components["schemas"]["InputFieldErrorResponse"];
                };
            };
            /** @description Extraction queue full; original preserved. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin result rejected. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider or plugin environment missing. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin timeout; original preserved. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
        };
    };
    compare_api_documents__did__comparisons_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                did: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExtractionComparisonRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExtractionComparisonResponse"];
                };
            };
            /** @description Original/run/proposal not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Revision/idempotency/consent conflict. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Specific field, PDF format, unit or review error. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"] | components["schemas"]["InputFieldErrorResponse"];
                };
            };
            /** @description Extraction queue full; original preserved. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin result rejected. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider or plugin environment missing. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin timeout; original preserved. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
        };
    };
    proposal_api_documents__did__proposals__pid__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                did: string;
                pid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProposalResponse"];
                };
            };
            /** @description Original/run/proposal not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Revision/idempotency/consent conflict. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Specific field, PDF format, unit or review error. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"] | components["schemas"]["InputFieldErrorResponse"];
                };
            };
            /** @description Extraction queue full; original preserved. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin result rejected. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider or plugin environment missing. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin timeout; original preserved. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
        };
    };
    approve_api_documents__did__proposals__pid__approval_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                did: string;
                pid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApprovalRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProposalResponse"];
                };
            };
            /** @description Original/run/proposal not found. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Revision/idempotency/consent conflict. */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Specific field, PDF format, unit or review error. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"] | components["schemas"]["InputFieldErrorResponse"];
                };
            };
            /** @description Extraction queue full; original preserved. */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin result rejected. */
            502: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider or plugin environment missing. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
            /** @description Provider/plugin timeout; original preserved. */
            504: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentErrorResponse"];
                };
            };
        };
    };
    get_api_workspaces__wid__domain_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    save_api_workspaces__wid__domain_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveDomain"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    preview_api_workspaces__wid__domain_conversion_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    migrate_api_workspaces__wid__domain_conversion_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Revision"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    library_api_types_library_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    comparison_api_types__wid__comparison_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    branch_api_types__wid__plans_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Branch"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    adopt_api_types__wid__adopt_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Adopt"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    specification_api_types__wid__specification_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    specification_file_api_types__wid__specification_file_get: {
        parameters: {
            query: {
                expected_revision: number;
                specification_digest: string;
            };
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    submit_api_types__wid__submissions_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Submit"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    approve_api_types__wid__approve_post: {
        parameters: {
            query?: never;
            header?: {
                "x-cablesim-actor"?: string | null;
            };
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Approval"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    publish_api_types__wid__publish_post: {
        parameters: {
            query?: never;
            header?: {
                "x-cablesim-actor"?: string | null;
            };
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Publish"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    models_api_design_cable_models_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    study_catalog_api_design_study_cable_models_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    examples_api_design_engineering_examples_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    types_api_design_type_workspaces_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    create_type_api_design_type_workspaces_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChooseModel"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    layout_api_design_workspaces__wid__section_template_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LayoutPreview"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_api_design_study_workspaces_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateStudyWorkspace"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    bind_api_design_workspaces__wid__cable_reference_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BindModel"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    read_api_design_type_workspaces__wid__requirements_get: {
        parameters: {
            query: {
                run_id: string;
            };
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    review_api_design_type_workspaces__wid__requirements_reviews_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReviewRequirements"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    definition_api_design_workspaces__wid__rating_table_definition_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RatingTableDefinition"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    results_api_design_workspaces__wid__rating_table_runs__rid__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                rid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    health_api_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    get_presets_api_presets_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
    home__get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/html": string;
                };
            };
        };
    };
}

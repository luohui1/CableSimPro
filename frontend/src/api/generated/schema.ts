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
    "/api/plugins/{plugin_id}/assets/{role}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Plugin Asset */
        get: operations["plugin_asset_api_plugins__plugin_id__assets__role__get"];
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
    "/api/studies/{sid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Direct Study Detail */
        get: operations["direct_study_detail_api_studies__sid__get"];
        put?: never;
        post?: never;
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
        /** Study Detail */
        get: operations["study_detail_api_workspaces__wid__studies__sid__get"];
        /** Update */
        put: operations["update_api_workspaces__wid__studies__sid__put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies/{sid}/recalculate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Recalculate */
        post: operations["recalculate_api_workspaces__wid__studies__sid__recalculate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies/{sid}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview */
        post: operations["preview_api_workspaces__wid__studies__sid__preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies/{sid}/upgrade-methods": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Upgrade Methods */
        post: operations["upgrade_methods_api_workspaces__wid__studies__sid__upgrade_methods_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies/{sid}/undo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Undo */
        post: operations["undo_api_workspaces__wid__studies__sid__undo_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies/{sid}/redo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Redo */
        post: operations["redo_api_workspaces__wid__studies__sid__redo_post"];
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
    "/api/workspaces/{wid}/studies/{sid}/runs/{rid}/cases/{case_id}/input": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Run Case Input */
        get: operations["run_case_input_api_workspaces__wid__studies__sid__runs__rid__cases__case_id__input_get"];
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
        /** Deliveries */
        get: operations["deliveries_api_workspaces__wid__deliveries_get"];
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
    "/api/database/version": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Version */
        get: operations["version_api_database_version_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/database/backups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Listing */
        get: operations["listing_api_database_backups_get"];
        put?: never;
        /** Create */
        post: operations["create_api_database_backups_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/database/backups/{identifier}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download */
        get: operations["download_api_database_backups__identifier__file_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/database/restores": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Request Restore */
        post: operations["request_restore_api_database_restores_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/database/restores/current": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Restore Status */
        get: operations["restore_status_api_database_restores_current_get"];
        put?: never;
        post?: never;
        /** Cancel Restore */
        delete: operations["cancel_restore_api_database_restores_current_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/delivery-jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create Delivery Job */
        post: operations["create_delivery_job_api_workspaces__wid__delivery_jobs_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/delivery-jobs/{jid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Delivery Job */
        get: operations["delivery_job_api_workspaces__wid__delivery_jobs__jid__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/delivery-jobs/{jid}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel Delivery Job */
        post: operations["cancel_delivery_job_api_workspaces__wid__delivery_jobs__jid__cancel_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/runs/{rid}/fem-conclusion": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Saved Fem Conclusion */
        get: operations["saved_fem_conclusion_api_workspaces__wid__runs__rid__fem_conclusion_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/simulation/problem-contract": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Simulation Problem Contract */
        get: operations["simulation_problem_contract_api_simulation_problem_contract_get"];
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
    "/api/workspaces/{wid}/deliveries/{did}/pdf": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Delivery Pdf */
        get: operations["delivery_pdf_api_workspaces__wid__deliveries__did__pdf_get"];
        put?: never;
        post?: never;
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
    "/api/plugin-queries/{plugin_id}/{capability_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Query */
        post: operations["query_api_plugin_queries__plugin_id___capability_id__post"];
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
    "/api/workspaces/{wid}/studies/{sid}/runs/{rid}/progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Progress */
        get: operations["progress_api_workspaces__wid__studies__sid__runs__rid__progress_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{wid}/studies/{sid}/runs/{rid}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel */
        post: operations["cancel_api_workspaces__wid__studies__sid__runs__rid__cancel_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Profile */
        get: operations["profile_api_hpc_profile_get"];
        /** Save Profile */
        put: operations["save_profile_api_hpc_profile_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/heat-capacity/preflight": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Heat Capacity Preflight
         * @description Validate sourced SI capacities locally, without staging a solver job.
         */
        post: operations["heat_capacity_preflight_api_hpc_heat_capacity_preflight_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/profile/configuration": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Profile Configuration */
        get: operations["profile_configuration_api_hpc_profile_configuration_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/profile/undo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Undo Profile */
        post: operations["undo_profile_api_hpc_profile_undo_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/profile/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Check Profile */
        post: operations["check_profile_api_hpc_profile_check_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/workspaces/{wid}/studies/{sid}/input-preflight": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Input Preflight */
        get: operations["input_preflight_api_hpc_workspaces__wid__studies__sid__input_preflight_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/workspaces/{wid}/studies/{sid}/step-responses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Step Responses */
        get: operations["step_responses_api_hpc_workspaces__wid__studies__sid__step_responses_get"];
        put?: never;
        /** Step Start */
        post: operations["step_start_api_hpc_workspaces__wid__studies__sid__step_responses_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/workspaces/{wid}/studies/{sid}/step-responses/estimate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Step Estimate */
        post: operations["step_estimate_api_hpc_workspaces__wid__studies__sid__step_responses_estimate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/workspaces/{wid}/studies/{sid}/step-responses/source-check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Step Source Check */
        get: operations["step_source_check_api_hpc_workspaces__wid__studies__sid__step_responses_source_check_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/step-responses/{identifier}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Step Detail */
        get: operations["step_detail_api_hpc_step_responses__identifier__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/step-responses/{identifier}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Step Cancel */
        post: operations["step_cancel_api_hpc_step_responses__identifier__cancel_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/step-responses/{identifier}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Step Resume */
        post: operations["step_resume_api_hpc_step_responses__identifier__resume_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Jobs */
        get: operations["jobs_api_hpc_jobs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/jobs/{identifier}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Job Detail */
        get: operations["job_detail_api_hpc_jobs__identifier__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/jobs/{identifier}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel */
        post: operations["cancel_api_hpc_jobs__identifier__cancel_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/jobs/{identifier}/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Refresh */
        post: operations["refresh_api_hpc_jobs__identifier__refresh_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/convergence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Convergence */
        get: operations["convergence_api_hpc_convergence_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/workspaces/{wid}/studies/{sid}/estimate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Estimate */
        get: operations["estimate_api_hpc_workspaces__wid__studies__sid__estimate_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/workspaces/{wid}/studies/{sid}/availability": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Availability */
        get: operations["availability_api_hpc_workspaces__wid__studies__sid__availability_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/workspaces/{wid}/studies/{sid}/convergence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start */
        post: operations["start_api_hpc_workspaces__wid__studies__sid__convergence_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/convergence/{identifier}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Detail */
        get: operations["detail_api_hpc_convergence__identifier__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/convergence/{identifier}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel Convergence */
        post: operations["cancel_convergence_api_hpc_convergence__identifier__cancel_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/convergence/{identifier}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resume */
        post: operations["resume_api_hpc_convergence__identifier__resume_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/workspaces/{wid}/chapters/{rid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Report Chapter */
        get: operations["report_chapter_api_hpc_workspaces__wid__chapters__rid__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/workspaces/{wid}/fields/{rid}.png": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Image */
        get: operations["image_api_hpc_workspaces__wid__fields__rid__png_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/workspaces/{wid}/fields/{rid}/view": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Field View
         * @description Verified display projection: binary arrays stay on the server.
         */
        get: operations["field_view_api_hpc_workspaces__wid__fields__rid__view_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/workspaces/{wid}/fields/{rid}/full": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Field Archive
         * @description Download lossless arrays; normal view requests never download these.
         */
        get: operations["field_archive_api_hpc_workspaces__wid__fields__rid__full_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/hpc/workspaces/{wid}/fields/{rid}/sample": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Field Sample */
        post: operations["field_sample_api_hpc_workspaces__wid__fields__rid__sample_post"];
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
    "/api/documents/{did}/batches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Batch Propose */
        post: operations["batch_propose_api_documents__did__batches_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/documents/{did}/batches/{bid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Batch */
        get: operations["batch_api_documents__did__batches__bid__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/documents/{did}/batches/{bid}/approval": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Batch Approve */
        post: operations["batch_approve_api_documents__did__batches__bid__approval_post"];
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
    "/api/types/{wid}/release-scope": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Declare Scope */
        post: operations["declare_scope_api_types__wid__release_scope_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/short-circuit-basis": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Short Circuit Basis */
        post: operations["short_circuit_basis_api_types__wid__short_circuit_basis_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/creation-options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Creation Options */
        get: operations["creation_options_api_types_creation_options_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/creation-proposals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Creation Proposal */
        post: operations["creation_proposal_api_types_creation_proposals_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create */
        post: operations["create_api_types_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/document": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Save Document */
        put: operations["save_document_api_types__wid__document_put"];
        post?: never;
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
    "/api/types/{wid}/resources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Resources */
        get: operations["resources_api_types__wid__resources_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/workspace": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Type Workspace */
        get: operations["type_workspace_api_types__wid__workspace_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/resources/bind": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Bind Resource */
        post: operations["bind_resource_api_types__wid__resources_bind_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/resources/material-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview Material Bindings */
        post: operations["preview_material_bindings_api_types__wid__resources_material_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/resources/material-confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm Material Bindings */
        post: operations["confirm_material_bindings_api_types__wid__resources_material_confirm_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/resources/migrate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Migrate Resources */
        post: operations["migrate_resources_api_types__wid__resources_migrate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/material-comparison": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Material Comparison */
        get: operations["material_comparison_api_types__wid__material_comparison_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/material-comparison/adopt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Adopt Material Value */
        post: operations["adopt_material_value_api_types__wid__material_comparison_adopt_post"];
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
    "/api/types/{wid}/specification/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate Specification */
        post: operations["generate_specification_api_types__wid__specification_generate_post"];
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
    "/api/types/{wid}/measurements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Save Measurements */
        post: operations["save_measurements_api_types__wid__measurements_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/standards-summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Standards Summary */
        get: operations["standards_summary_api_types__wid__standards_summary_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/display-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Display Runs */
        get: operations["display_runs_api_types__wid__display_runs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/types/{wid}/measurements/reports/{report_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Measurement Report */
        get: operations["measurement_report_api_types__wid__measurements_reports__report_id__get"];
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
    "/api/type-library/vocabulary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Vocabulary */
        get: operations["vocabulary_api_type_library_vocabulary_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/type-library/mappings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Mappings */
        get: operations["mappings_api_type_library_mappings_get"];
        put?: never;
        /** Mapping */
        post: operations["mapping_api_type_library_mappings_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/type-library/imports/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Upload */
        post: operations["upload_api_type_library_imports_upload_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/type-library/imports/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview */
        post: operations["preview_api_type_library_imports_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/type-library/imports/commit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Commit */
        post: operations["commit_api_type_library_imports_commit_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/type-library/series": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Series */
        get: operations["series_api_type_library_series_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/type-library/series/{identifier}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Series Detail */
        get: operations["series_detail_api_type_library_series__identifier__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/type-library/specs/{identifier}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Spec */
        get: operations["spec_api_type_library_specs__identifier__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/type-library/specs/{identifier}/revisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revise */
        post: operations["revise_api_type_library_specs__identifier__revisions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/type-library/series/{identifier}/batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Batch */
        post: operations["batch_api_type_library_series__identifier__batch_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/type-library/samples": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Samples */
        get: operations["samples_api_type_library_samples_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/type-library/samples/{name}.xlsx": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sample Xlsx */
        get: operations["sample_xlsx_api_type_library_samples__name__xlsx_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/type-library/samples/{name}.csv": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sample Csv */
        get: operations["sample_csv_api_type_library_samples__name__csv_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/type-library/catalogue-comparison/{name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Comparison */
        post: operations["comparison_api_type_library_catalogue_comparison__name__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/type-library/exchange/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Export Route */
        post: operations["export_route_api_type_library_exchange_export_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/type-library/exchange/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview Route */
        post: operations["preview_route_api_type_library_exchange_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/type-library/exchange/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Import Route */
        post: operations["import_route_api_type_library_exchange_import_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/exchange/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Export */
        post: operations["export_api_library_exchange_export_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/exchange/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview */
        post: operations["preview_api_library_exchange_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/exchange/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Import Data */
        post: operations["import_data_api_library_exchange_import_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/catalogue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Catalogue */
        get: operations["catalogue_api_library_resources_catalogue_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/table": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Table */
        get: operations["table_api_library_resources_table_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/select": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Select */
        post: operations["select_api_library_resources_select_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/materials/draft-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Draft Preview */
        post: operations["draft_preview_api_library_resources_materials_draft_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/materials/draft": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Draft */
        post: operations["draft_api_library_resources_materials_draft_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/materials/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview */
        post: operations["preview_api_library_resources_materials_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/materials/adopt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Adopt */
        post: operations["adopt_api_library_resources_materials_adopt_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/environment/draft-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview Draft */
        post: operations["preview_draft_api_library_resources_environment_draft_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/environment/draft": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create Asset */
        post: operations["create_asset_api_library_resources_environment_draft_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/environment/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview Asset */
        post: operations["preview_asset_api_library_resources_environment_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/applications/{resource_id}/evidence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Evidence */
        get: operations["evidence_api_library_resources_applications__resource_id__evidence_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/study-templates/capture-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Study Capture Preview */
        post: operations["study_capture_preview_api_library_resources_study_templates_capture_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/study-templates/capture": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Study Capture */
        post: operations["study_capture_api_library_resources_study_templates_capture_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/study-templates/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Study Preview */
        post: operations["study_preview_api_library_resources_study_templates_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/study-templates/adopt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Study Adopt */
        post: operations["study_adopt_api_library_resources_study_templates_adopt_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/components/capture-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview Capture */
        post: operations["preview_capture_api_library_resources_components_capture_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/components/capture": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Capture */
        post: operations["capture_api_library_resources_components_capture_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/components/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview */
        post: operations["preview_api_library_resources_components_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/library/resources/components/adopt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Adopt */
        post: operations["adopt_api_library_resources_components_adopt_post"];
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
    "/api/design/type-workspaces/{wid}/requirements/basis": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resolve */
        post: operations["resolve_api_design_type_workspaces__wid__requirements_basis_post"];
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
    "/api/formal-deliveries/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview */
        post: operations["preview_api_formal_deliveries_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/formal-deliveries/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Export */
        post: operations["export_api_formal_deliveries_export_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/formal-deliveries/batch/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Batch Preview */
        post: operations["batch_preview_api_formal_deliveries_batch_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/formal-deliveries/batch/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Batch Export */
        post: operations["batch_export_api_formal_deliveries_batch_export_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Capabilities */
        get: operations["capabilities_api_agent_capabilities_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Status */
        get: operations["status_api_agent_status_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Settings */
        get: operations["settings_api_agent_settings_get"];
        /** Save Settings */
        put: operations["save_settings_api_agent_settings_put"];
        post?: never;
        /** Reset Settings */
        delete: operations["reset_settings_api_agent_settings_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/settings/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Test Settings */
        post: operations["test_settings_api_agent_settings_test_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/memory/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Memory Settings */
        get: operations["memory_settings_api_agent_memory_settings_get"];
        /** Save Memory Settings */
        put: operations["save_memory_settings_api_agent_memory_settings_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/memories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Memories */
        get: operations["memories_api_agent_memories_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/memories/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Correct Memory */
        put: operations["correct_memory_api_agent_memories__id__put"];
        post?: never;
        /** Delete Memory */
        delete: operations["delete_memory_api_agent_memories__id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/sessions/{id}/memory": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Session Memory */
        get: operations["session_memory_api_agent_sessions__id__memory_get"];
        put?: never;
        /** Remember Session */
        post: operations["remember_session_api_agent_sessions__id__memory_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/tools": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Tools */
        get: operations["tools_api_agent_tools_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/recipes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Recipe Catalog */
        get: operations["recipe_catalog_api_agent_recipes_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sessions */
        get: operations["sessions_api_agent_sessions_get"];
        put?: never;
        /** Create */
        post: operations["create_api_agent_sessions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/sessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Session */
        get: operations["session_api_agent_sessions__id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/sessions/{id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Message */
        post: operations["message_api_agent_sessions__id__messages_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/proposals/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve */
        post: operations["approve_api_agent_proposals__id__approve_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/proposals/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reject */
        post: operations["reject_api_agent_proposals__id__reject_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/sessions/{id}/reconcile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reconcile */
        post: operations["reconcile_api_agent_sessions__id__reconcile_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/agent/contract": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Contract */
        get: operations["contract_api_agent_contract_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/index/objects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Objects */
        get: operations["objects_api_index_objects_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/index/objects/{kind}/{id}/relations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Relations */
        get: operations["relations_api_index_objects__kind___id__relations_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/index/inbox": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Inbox */
        get: operations["inbox_api_index_inbox_get"];
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
        /** AdoptComponent */
        AdoptComponent: {
            /** Preview Digest */
            preview_digest: string;
            /**
             * Human Confirmed
             * @constant
             */
            human_confirmed: true;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Acknowledge Reference Limits
             * @constant
             */
            acknowledge_reference_limits: true;
            /**
             * Resource Id
             * Format: uuid
             */
            resource_id: string;
            /** Content Sha256 */
            content_sha256: string;
            /**
             * Workspace Id
             * Format: uuid
             */
            workspace_id: string;
            /** Expected Revision */
            expected_revision: number;
            target: components["schemas"]["ComponentSelection"];
            /** Target Material Id */
            target_material_id: string;
            /**
             * Operation
             * @default adopt_resource_component
             * @constant
             */
            operation?: "adopt_resource_component";
        };
        /** AdoptMaterialReference */
        AdoptMaterialReference: {
            /**
             * Workspace Id
             * Format: uuid
             */
            workspace_id: string;
            /** Expected Revision */
            expected_revision: number;
            /** Material Id */
            material_id: string;
            /**
             * Property
             * @enum {string}
             */
            property: "density" | "volumetric_heat_capacity" | "electrical_resistivity_20" | "relative_permittivity" | "thermal_resistivity";
            /**
             * Resource Id
             * Format: uuid
             */
            resource_id: string;
            /** Content Sha256 */
            content_sha256: string;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Operation
             * @default adopt_resource_material_value
             * @constant
             */
            operation?: "adopt_resource_material_value";
            /** Preview Digest */
            preview_digest: string;
            /**
             * Human Confirmed
             * @constant
             */
            human_confirmed: true;
            /**
             * Acknowledge Reference Limits
             * @constant
             */
            acknowledge_reference_limits: true;
        };
        /** AdoptMaterialValue */
        AdoptMaterialValue: {
            /** Expected Revision */
            expected_revision: number;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Operation
             * @default adopt_material_value
             * @constant
             */
            operation?: "adopt_material_value";
            /** Material Id */
            material_id: string;
            /** Property */
            property: string;
            /**
             * Resource Id
             * Format: uuid
             */
            resource_id: string;
            /** Content Sha256 */
            content_sha256: string;
        };
        /** AdoptStudyTemplate */
        AdoptStudyTemplate: {
            /** Preview Digest */
            preview_digest: string;
            /**
             * Human Confirmed
             * @constant
             */
            human_confirmed: true;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Acknowledge Reference Limits
             * @constant
             */
            acknowledge_reference_limits: true;
            /**
             * Resource Id
             * Format: uuid
             */
            resource_id: string;
            /** Content Sha256 */
            content_sha256: string;
            /**
             * Workspace Id
             * Format: uuid
             */
            workspace_id: string;
            /** Expected Revision */
            expected_revision: number;
            /** Title */
            title: string;
            bindings: components["schemas"]["StudyBindings"];
            /**
             * Operation
             * @default adopt_resource_study_template
             * @constant
             */
            operation?: "adopt_resource_study_template";
        };
        /** AgentStatus */
        AgentStatus: {
            /** Configured */
            configured: boolean;
            /** Model */
            model: string;
            /** Tools */
            tools: number;
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
        /** AmpacityBasis */
        AmpacityBasis: {
            /**
             * Kind
             * @description Single circuit capability, common balanced current in all circuits, or conditional limit with other cable loads fixed.
             * @enum {string}
             */
            kind: "single_circuit" | "common_balanced" | "conditional_fixed_load";
            /**
             * Display Name
             * @description Display name including fixed load values where applicable.
             */
            display_name: string;
            /**
             * Varied Circuits
             * @description Circuit IDs whose currents vary during the rating search.
             */
            varied_circuits: string[];
            /**
             * Fixed Currents A
             * @description Fixed RMS currents by physical cable ID, in A; preserves unequal phase loads.
             */
            fixed_currents_a?: {
                [key: string]: number;
            };
        };
        /** AnalysisBasis */
        AnalysisBasis: {
            /** Expected Revision */
            expected_revision: number;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /** Parameters */
            parameters: {
                [key: string]: unknown;
            };
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
            /**
             * Reference Evidence
             * @default []
             */
            reference_evidence?: components["schemas"]["ReferenceEvidence"][];
            application?: components["schemas"]["ResourceApplication"] | null;
        };
        /** AuditEvent */
        AuditEvent: {
            /** Sequence */
            sequence: number;
            /** Type */
            type: string;
            /** Created */
            created: string;
            /** Data */
            data: {
                [key: string]: components["schemas"]["JsonValue"];
            };
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
        /** Batch */
        Batch: {
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Operation
             * @enum {string}
             */
            operation: "check" | "calculate" | "review";
            /** Spec Ids */
            spec_ids: string[];
            /** Expected Versions */
            expected_versions: {
                [key: string]: number;
            };
            /** Expected Revisions */
            expected_revisions: {
                [key: string]: number;
            };
            /**
             * Human Confirmed
             * @constant
             */
            human_confirmed: true;
            /**
             * Scope Acknowledged
             * @constant
             */
            scope_acknowledged: true;
            /** Parameters */
            parameters?: {
                [key: string]: unknown;
            };
            /** Rows */
            rows?: {
                [key: string]: unknown;
            }[];
            /** Environment References */
            environment_references?: components["schemas"]["EnvironmentAdoption"][];
            /**
             * Action
             * @default submit
             * @enum {string}
             */
            action?: "submit" | "approve" | "publish";
            /**
             * Note
             * @default
             */
            note?: string;
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
        /** BatchExportRequest */
        BatchExportRequest: {
            /** Scope */
            scope: components["schemas"]["ProjectScope"] | components["schemas"]["SeriesScope"];
            /** Items */
            items: components["schemas"]["BatchItem"][];
            /** Expected Batch Digest */
            expected_batch_digest: string;
        };
        /** BatchItem */
        BatchItem: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "specification" | "calculation" | "rating_table" | "research_report";
            source: components["schemas"]["SourceSelection"];
            document: components["schemas"]["DocumentMetadata"];
            /** Key */
            key: string;
            /** Formats */
            formats: ("pdf" | "xlsx")[];
        };
        /** BatchPreviewRequest */
        BatchPreviewRequest: {
            /** Scope */
            scope: components["schemas"]["ProjectScope"] | components["schemas"]["SeriesScope"];
            /** Items */
            items: components["schemas"]["BatchItem"][];
        };
        /** BatchProposalRequest */
        BatchProposalRequest: {
            /**
             * Request Id
             * Format: uuid
             * @description Idempotency key for the complete batch.
             */
            request_id: string;
            /**
             * Items
             * @description One completely reviewed extraction and explicit target identity per specification.
             */
            items: components["schemas"]["ProposalRequest"][];
        };
        /** BatchProposalResponse */
        BatchProposalResponse: {
            /** Id */
            id: string;
            /** Document Id */
            document_id: string;
            /**
             * Sha256
             * @description Digest binding all individual proposal IDs and digests.
             */
            sha256: string;
            /**
             * Status
             * @enum {string}
             */
            status: "proposed" | "approved";
            /** Proposals */
            proposals: components["schemas"]["ProposalResponse"][];
            /** Approval */
            approval?: {
                [key: string]: unknown;
            } | null;
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
        /** BindResource */
        BindResource: {
            /** Expected Revision */
            expected_revision: number;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Operation
             * @default bind_resource
             * @constant
             */
            operation?: "bind_resource";
            /**
             * Role
             * @enum {string}
             */
            role: "material" | "standard";
            /** Target Id */
            target_id: string;
            /** Resource Id */
            resource_id?: string | null;
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
        /** Body_import_data_api_library_exchange_import_post */
        Body_import_data_api_library_exchange_import_post: {
            /**
             * File
             * Format: binary
             */
            file: string;
            /** Reviewed Sha256 */
            reviewed_sha256: string;
            /** Confirmed */
            confirmed: boolean;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
        };
        /** Body_import_route_api_type_library_exchange_import_post */
        Body_import_route_api_type_library_exchange_import_post: {
            /**
             * File
             * Format: binary
             */
            file: string;
            /** Reviewed Sha256 */
            reviewed_sha256: string;
            /** Confirmed */
            confirmed: boolean;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
        };
        /** Body_preview_api_library_exchange_preview_post */
        Body_preview_api_library_exchange_preview_post: {
            /**
             * File
             * Format: binary
             */
            file: string;
        };
        /** Body_preview_route_api_type_library_exchange_preview_post */
        Body_preview_route_api_type_library_exchange_preview_post: {
            /**
             * File
             * Format: binary
             */
            file: string;
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
        /** Body_upload_api_type_library_imports_upload_post */
        Body_upload_api_type_library_imports_upload_post: {
            /**
             * File
             * Format: binary
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
        /** CadCamera */
        CadCamera: {
            /**
             * Yaw
             * @description Radians.
             */
            yaw: number;
            /**
             * Elevation
             * @description Radians.
             */
            elevation: number;
            /**
             * Heading
             * @description Radians.
             */
            heading: number;
            /**
             * Zoom
             * @description Dimensionless viewport zoom.
             */
            zoom: number;
            /**
             * Panx
             * @description Viewport horizontal pan, pixels.
             */
            panX: number;
            /**
             * Pany
             * @description Viewport vertical pan, pixels.
             */
            panY: number;
            /**
             * View
             * @enum {string}
             */
            view: "iso" | "front" | "end" | "top" | "free";
            /**
             * Mode
             * @enum {string}
             */
            mode: "peel" | "section" | "transparent" | "scene";
            /**
             * Section
             * @description Normalized slice position, dimensionless.
             */
            section: number;
        };
        /** CadField */
        CadField: {
            /**
             * Runid
             * Format: uuid
             * @description Saved source run identity; no unit.
             */
            runId: string;
            /**
             * Caseid
             * @description Saved case identity.
             */
            caseId: string;
            /**
             * Source
             * @description Source label containing the sealed method digest.
             */
            source: string;
            /** Label */
            label?: string | null;
            /** Kind */
            kind?: ("iec" | "fem" | "difference") | null;
            /**
             * Minimum
             * @description Displayed lower colour-scale endpoint, degC or K for a difference.
             */
            minimum: number;
            /**
             * Maximum
             * @description Displayed upper colour-scale endpoint, degC or K for a difference.
             */
            maximum: number;
            /** References */
            references?: components["schemas"]["CadFieldReference"][];
            /**
             * Provisional
             * @description Trial images are excluded from formal deliveries.
             * @default false
             */
            provisional?: boolean;
        };
        /** CadFieldReference */
        CadFieldReference: {
            /**
             * Runid
             * Format: uuid
             * @description Saved source run identity; no unit.
             */
            runId: string;
            /**
             * Caseid
             * @description Saved case identity.
             */
            caseId: string;
            /**
             * Source
             * @description Source label containing the sealed method digest.
             */
            source: string;
            /** Label */
            label?: string | null;
        };
        /** CadImageMetadata */
        CadImageMetadata: {
            /**
             * Schema
             * @constant
             */
            schema: "cablesim.cad-image/1";
            /**
             * Mime
             * @constant
             */
            mime: "image/png";
            /**
             * Width
             * @description PNG width, pixels.
             */
            width: number;
            /**
             * Height
             * @description PNG height including legend/source footer, pixels.
             */
            height: number;
            camera: components["schemas"]["CadCamera"];
            /**
             * Geometryinputsha256
             * @description Displayed scene-input SHA256.
             */
            geometryInputSha256: string;
            /**
             * Displaylengthm
             * @description Displayed cable length, m.
             */
            displayLengthM: number;
            /**
             * Scalemmperpixel
             * @description Display scale, mm/pixel.
             */
            scaleMmPerPixel: number;
            /** @description Saved result and legend source; geometry-only or trial exports are not engineering evidence. */
            field: components["schemas"]["CadField"];
        };
        /** CadReportImage */
        CadReportImage: {
            /**
             * Png Base64
             * @description PNG bytes, Base64; at most 8 MiB decoded.
             */
            png_base64: string;
            metadata: components["schemas"]["CadImageMetadata"];
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
             * @description Source evidence rectangle [left,top,right,bottom], PDF points, top-left origin. Native text cites cells/glyphs; local OCR cites recovered cells, Mistral OCR cites its containing table block.
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
        /** CapabilityQuery */
        CapabilityQuery: {
            /** Release Digest */
            release_digest: string;
            /** Input */
            input: {
                [key: string]: components["schemas"]["JsonValue"];
            };
        };
        /** CaptureAsset */
        CaptureAsset: {
            /** Expected Revision */
            expected_revision: number;
            /**
             * Human Confirmed
             * @default false
             */
            human_confirmed?: boolean;
            /** Name */
            name: string;
        };
        /** CaptureComponent */
        CaptureComponent: {
            /** Asset Id */
            asset_id: string;
            /** Version */
            version: string;
            /** Name */
            name: string;
            /**
             * Workspace Id
             * Format: uuid
             */
            workspace_id: string;
            /** Expected Revision */
            expected_revision: number;
            selection: components["schemas"]["ComponentSelection"];
        };
        /** CaptureStudy */
        CaptureStudy: {
            /** Asset Id */
            asset_id: string;
            /** Version */
            version: string;
            /** Name */
            name: string;
            /**
             * Workspace Id
             * Format: uuid
             */
            workspace_id: string;
            /** Expected Revision */
            expected_revision: number;
            /**
             * Study Id
             * Format: uuid
             */
            study_id: string;
            /** Expected Study Revision */
            expected_study_revision: number;
            /**
             * Source Run Id
             * Format: uuid
             */
            source_run_id: string;
        };
        /** CatalogueComparison */
        CatalogueComparison: {
            /**
             * Reference Scenario Confirmed
             * @default false
             */
            reference_scenario_confirmed?: boolean;
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
            results: components["schemas"]["QuantityResult"][];
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
        /** Commit */
        Commit: {
            /**
             * Preview Id
             * Format: uuid
             */
            preview_id: string;
            /** Preview Digest */
            preview_digest: string;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Human Confirmed
             * @constant
             */
            human_confirmed: true;
            /**
             * Skip Errors
             * @default false
             */
            skip_errors?: boolean;
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
        /** ComponentSelection */
        ComponentSelection: {
            /** Cable Type Id */
            cable_type_id: string;
            /** Core Id */
            core_id?: string | null;
            /**
             * Part
             * @enum {string}
             */
            part: "conductor" | "core_layer" | "common_layer";
            /** Layer Index */
            layer_index?: number | null;
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
            /**
             * Diameter
             * @description 圆形导体外径；扇形导体为圆弧直径，圆心由芯坐标确定，m
             */
            diameter: number;
            /**
             * Sector Angle Deg
             * @description 扇形导体夹角，°；不从标称截面反推
             */
            sector_angle_deg?: number | null;
            /**
             * Sector Rotation Deg
             * @description 扇形角平分线从 +x 朝 +z 的转角，°
             */
            sector_rotation_deg?: number | null;
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
        /** ConfirmMaterialBindings */
        ConfirmMaterialBindings: {
            /** Expected Revision */
            expected_revision: number;
            /** Items */
            items: components["schemas"]["MaterialBindingItem"][];
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Operation
             * @default bind_material_batch
             * @constant
             */
            operation?: "bind_material_batch";
            /** Preview Digest */
            preview_digest: string;
            /** Reviewed Targets */
            reviewed_targets: string[];
            /**
             * Human Confirmed
             * @constant
             */
            human_confirmed: true;
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
        /** CreateComponent */
        CreateComponent: {
            /** Preview Digest */
            preview_digest: string;
            /**
             * Human Confirmed
             * @constant
             */
            human_confirmed: true;
            /** Asset Id */
            asset_id: string;
            /** Version */
            version: string;
            /** Name */
            name: string;
            /**
             * Workspace Id
             * Format: uuid
             */
            workspace_id: string;
            /** Expected Revision */
            expected_revision: number;
            selection: components["schemas"]["ComponentSelection"];
        };
        /** CreateMaterialReferenceDraft */
        CreateMaterialReferenceDraft: {
            /** Asset Id */
            asset_id: string;
            /** Version */
            version: string;
            /** Name */
            name: string;
            /** Selections */
            selections: components["schemas"]["MaterialSelection"][];
            /** Preview Digest */
            preview_digest: string;
            /**
             * Human Confirmed
             * @constant
             */
            human_confirmed: true;
        };
        /** CreateSession */
        CreateSession: {
            /**
             * Workspace Id
             * Format: uuid
             */
            workspace_id: string;
            /** Study Id */
            study_id?: string | null;
        };
        /** CreateStudy */
        CreateStudy: {
            /** Title */
            title: string;
            /**
             * Task
             * @description Study objective; simulation tasks submit asynchronously to Slurm.
             */
            task?: ("rating" | "operating" | "target" | "transient-temperature" | "sheath-losses" | "electrothermal-steady" | "iec-fem-comparison") | null;
            method: components["schemas"]["Method"];
            /**
             * Input Source
             * @default domain
             * @enum {string}
             */
            input_source?: "domain" | "study";
            /**
             * Method Input
             * @description Saved standalone plugin input. For cablesim.simulation-problem/1 use the exact GET /api/simulation/problem-contract schema; all lengths m, absolute temperature K, RMS current A.
             */
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
        /** CreateStudyTemplate */
        CreateStudyTemplate: {
            /** Preview Digest */
            preview_digest: string;
            /**
             * Human Confirmed
             * @constant
             */
            human_confirmed: true;
            /** Asset Id */
            asset_id: string;
            /** Version */
            version: string;
            /** Name */
            name: string;
            /**
             * Workspace Id
             * Format: uuid
             */
            workspace_id: string;
            /** Expected Revision */
            expected_revision: number;
            /**
             * Study Id
             * Format: uuid
             */
            study_id: string;
            /** Expected Study Revision */
            expected_study_revision: number;
            /**
             * Source Run Id
             * Format: uuid
             */
            source_run_id: string;
        };
        /** CreateStudyWorkspace */
        CreateStudyWorkspace: {
            /** Model Id */
            model_id: string;
            /** Content Sha256 */
            content_sha256: string;
            /**
             * Project Name
             * @description 工程师填写的客户与工程名称；单位：无。未提供时保持原有教学研究命名。
             */
            project_name?: string | null;
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
            /**
             * Cad Images
             * @description One exported CAD display image with colour scale and saved-run provenance.
             */
            cad_images?: components["schemas"]["CadReportImage"][];
            /**
             * Section Images
             * @description Section drawings from saved case inputs, with dimensions and saved conductor temperatures; no solver invocation.
             */
            section_images?: components["schemas"]["SectionReportImage"][];
            /** @description Host rebuilds the chapter from these saved runs; client values are never trusted. */
            fem_chapter?: components["schemas"]["FemChapterReference"] | null;
        };
        /** DatabaseError */
        DatabaseError: {
            /**
             * Detail
             * @description Stable code/message, or request field validation errors.
             */
            detail: {
                [key: string]: string;
            } | {
                [key: string]: components["schemas"]["JsonValue"];
            }[];
        };
        /** DatabaseVersion */
        DatabaseVersion: {
            /**
             * Database Schema Version
             * @description Current SQLite user_version; no unit.
             */
            database_schema_version: number;
            /**
             * Supported Schema Version
             * @description Maximum schema version this host supports; no unit.
             */
            supported_schema_version: number;
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
        /** DeclaredParameter */
        DeclaredParameter: {
            /** Value */
            value: number | string;
            /** Reference */
            reference: string;
            /** Unit */
            unit?: string | null;
        };
        /** DeliveryJob */
        DeliveryJob: {
            /**
             * Id
             * Format: uuid
             * @description Report generation job identity; does not create a solver run.
             */
            id: string;
            /**
             * Workspace
             * Format: uuid
             */
            workspace: string;
            /**
             * Request Id
             * Format: uuid
             * @description Idempotent retry identity for the exact source and attachments.
             */
            request_id: string;
            /**
             * State
             * @enum {string}
             */
            state: "queued" | "running" | "succeeded" | "cancelled" | "failed";
            /**
             * Stage
             * @description Observed formatting phase; cancellation is accepted until save begins.
             * @enum {string}
             */
            stage: "queued" | "source" | "evidence" | "field_image" | "pdf" | "html" | "consistency" | "layout_customer" | "layout_internal" | "pdf_customer" | "pdf_internal" | "archive" | "save" | "done";
            /**
             * Timings Seconds
             * @description Completed formatting phases and elapsed time; unit s. Measured from this job, not estimated.
             */
            timings_seconds?: {
                [key: string]: number;
            };
            /**
             * Elapsed Seconds
             * @description Total job execution duration; unit s. Present after successful commit.
             */
            elapsed_seconds?: number | null;
            /**
             * Created
             * @description UTC ISO 8601 admission time.
             */
            created: string;
            /**
             * Finished
             * @description UTC ISO 8601 terminal time.
             */
            finished: string | null;
            /**
             * Delivery Id
             * @description Saved delivery identity, present only after successful commit.
             */
            delivery_id: string | null;
            error: components["schemas"]["ApiErrorDetail"] | null;
            /** @description Committed delivery metadata; no HTML or source arrays. Binary PDF is read from its integrity-checked endpoint. */
            delivery_receipt?: components["schemas"]["DeliveryReceipt"] | null;
        };
        /** DeliveryReceipt */
        DeliveryReceipt: {
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
             * @description Saved renderer version.
             */
            renderer: string;
            /**
             * Digest
             * @description SHA256 of the complete saved HTML archive, renderer and sources.
             */
            digest: string;
            /**
             * Created
             * @description UTC creation timestamp.
             */
            created: string;
            version_status: components["schemas"]["VersionStatus"];
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
            /** @description Current version status of source runs; saved HTML and its digest are not rewritten. */
            version_status: components["schemas"]["VersionStatus"];
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
        /** DeliverySummary */
        DeliverySummary: {
            /**
             * Id
             * Format: uuid
             * @description Immutable delivery identity.
             */
            id: string;
            /**
             * Workspace
             * Format: uuid
             */
            workspace: string;
            /**
             * Kind
             * @description Saved calculation book or specification.
             * @enum {string}
             */
            kind: "calculation" | "specification";
            /**
             * Version
             * @description One-based generation sequence within this workspace; no unit.
             */
            version: number;
            /**
             * Renderer
             * @description Exact renderer version used to create this delivery.
             */
            renderer: string;
            /**
             * Created
             * @description UTC generation time; ISO 8601.
             */
            created: string;
            /**
             * Sources
             * @description Saved source runs and input/output SHA256; export does not rerun them.
             */
            sources: components["schemas"]["DeliverySource"][];
            /**
             * Digest
             * @description Integrity digest of renderer, sources and content.
             */
            digest: string;
            /**
             * Download Url
             * @description Relative API URL for integrity-checked saved HTML.
             */
            download_url: string;
            /**
             * Media Type
             * @default text/html
             * @constant
             */
            media_type?: "text/html";
            /** @description Dynamic source-version warning for an immutable historical delivery. */
            version_status: components["schemas"]["VersionStatus"];
        };
        /** DeriveAsset */
        DeriveAsset: {
            /** Expected Revision */
            expected_revision: number;
            /**
             * Human Confirmed
             * @default false
             */
            human_confirmed?: boolean;
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
            scope: components["schemas"]["ExtractionScope-Output"];
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
        /** DocumentMetadata */
        DocumentMetadata: {
            /** Organization */
            organization: string;
            /** Number */
            number: string;
            /** Revision */
            revision: string;
            /**
             * Header
             * @default
             */
            header?: string;
            /**
             * Footer
             * @default
             */
            footer?: string;
            /** Issued On */
            issued_on?: string | null;
            /** Logo Data Uri */
            logo_data_uri?: string | null;
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
        /** DraftCableType */
        DraftCableType: {
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
        /** DraftDomainDocument */
        DraftDomainDocument: {
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
            cable_types: components["schemas"]["DraftCableType"][];
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
             * @description Ampacity selection/sweep basis. individual: vary one circuit while holding other saved currents (A), enforcing every cable temperature limit; these conditional limits cannot be used together. simultaneous: common balanced RMS current (A) in all circuits, independent of saved target loads. Read result case=rating or rating-simultaneous respectively; never select by result order.
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
            /**
             * Human Confirmed
             * @default false
             */
            human_confirmed?: boolean;
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
        /** EnvironmentAdoption */
        EnvironmentAdoption: {
            /**
             * Workspace Id
             * Format: uuid
             */
            workspace_id: string;
            /** Expected Revision */
            expected_revision: number;
            row: components["schemas"]["RatingRow"];
            /** Resources */
            resources: components["schemas"]["EnvironmentPin"][];
            /** Conditions */
            conditions: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /** Preview Digest */
            preview_digest: string;
            /**
             * Human Confirmed
             * @constant
             */
            human_confirmed: true;
        };
        /** EnvironmentDraft */
        EnvironmentDraft: {
            /** Asset Id */
            asset_id: string;
            /** Version */
            version: string;
            /** Name */
            name: string;
            /** Selections */
            selections: components["schemas"]["backend__kernel__resource_data__Selection"][];
            /** Preview Digest */
            preview_digest: string;
            /**
             * Human Confirmed
             * @constant
             */
            human_confirmed: true;
        };
        /** EnvironmentDraftPreview */
        EnvironmentDraftPreview: {
            /** Asset Id */
            asset_id: string;
            /** Version */
            version: string;
            /** Name */
            name: string;
            /** Selections */
            selections: components["schemas"]["backend__kernel__resource_data__Selection"][];
        };
        /** EnvironmentPin */
        EnvironmentPin: {
            /**
             * Resource Id
             * Format: uuid
             */
            resource_id: string;
            /** Content Sha256 */
            content_sha256: string;
            /**
             * Parameter
             * @enum {string}
             */
            parameter: "depth_m" | "soil_rho_k_m_w" | "ambient_temperature_c";
        };
        /** EnvironmentPreview */
        EnvironmentPreview: {
            /**
             * Workspace Id
             * Format: uuid
             */
            workspace_id: string;
            /** Expected Revision */
            expected_revision: number;
            row: components["schemas"]["RatingRow"];
            /** Resources */
            resources: components["schemas"]["EnvironmentPin"][];
            /** Conditions */
            conditions: {
                [key: string]: components["schemas"]["JsonValue"];
            };
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
        /** ExportRequest */
        ExportRequest: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "specification" | "calculation" | "rating_table" | "research_report";
            source: components["schemas"]["SourceSelection"];
            document: components["schemas"]["DocumentMetadata"];
            /**
             * Format
             * @default pdf
             * @enum {string}
             */
            format?: "pdf" | "xlsx";
            /** Expected Model Digest */
            expected_model_digest: string;
        };
        /** ExportSelection */
        ExportSelection: {
            /** Asset Ids */
            asset_ids?: string[];
            /** Workspace Ids */
            workspace_ids?: string[];
            /**
             * Format
             * @default json
             * @enum {string}
             */
            format?: "json" | "xlsx";
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
            selections: components["schemas"]["backend__kernel__datasheet_contracts__Selection"][];
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
        "ExtractionScope-Input": {
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
            selections: components["schemas"]["backend__kernel__datasheet_contracts__Selection"][];
        };
        /** ExtractionScope */
        "ExtractionScope-Output": {
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
            selections: components["schemas"]["Selection-Output"][];
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
            quantity: "r20" | "minimum_thickness" | "maximum_thickness" | "mean_thickness" | "minimum_tape_thickness" | "mean_wire_diameter" | "screen_area";
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
        /** FemChapterReference */
        FemChapterReference: {
            /**
             * Fem Run Id
             * Format: uuid
             * @description Saved, converged FEM run in this workspace.
             */
            fem_run_id: string;
            /**
             * Iec Run Id
             * Format: uuid
             * @description Saved IEC run with matching input and electrical parameters.
             */
            iec_run_id: string;
            /**
             * Convergence Id
             * @description Saved mesh/domain convergence workflow bound to the final FEM run; no unit.
             */
            convergence_id?: string | null;
        };
        /** FemConclusion */
        FemConclusion: {
            /**
             * Schema Version
             * @default cablesim.fem-conclusion/1
             * @constant
             */
            schema_version?: "cablesim.fem-conclusion/1";
            /**
             * Run Id
             * Format: uuid
             */
            run_id: string;
            /**
             * Status
             * @enum {string}
             */
            status: "converged" | "unconverged";
            /** Reason */
            reason: string;
            /**
             * Tolerance K
             * @description Saved convergence threshold, K; cannot exceed 0.1 K.
             */
            tolerance_k: number;
            /**
             * Allowable Current A
             * @description Saved current capacity, A; absent without verified convergence.
             */
            allowable_current_a?: number | null;
            /**
             * Hottest Temperature K
             * @description Hottest saved conductor temperature, K; not the soil hotspot.
             */
            hottest_temperature_k?: number | null;
            /**
             * Margin K
             * @description Smallest per-conductor normal temperature-limit margin, K.
             */
            margin_k?: number | null;
            /**
             * Operating Currents A
             * @description Distinct operating currents from the verified saved case input, A; never from current workspace input.
             */
            operating_currents_a?: number[];
            /**
             * Temperature Limits K
             * @description Distinct conductor limits from the same saved case, K.
             */
            temperature_limits_k?: number[];
            /**
             * Rating Basis
             * @description Saved rating condition of the selected ampacity quantities.
             * @default
             */
            rating_basis?: string;
            /**
             * Boundary Label
             * @description Saved boundary display label from the plugin contract or verified chapter.
             * @default
             */
            boundary_label?: string;
            reference?: components["schemas"]["FemChapterReference"] | null;
            /**
             * Comparison
             * @description Same-input saved IEC comparison; empty if no verified match.
             */
            comparison?: components["schemas"]["FemValue"][];
        };
        /** FemValue */
        FemValue: {
            /**
             * Quantity
             * @enum {string}
             */
            quantity: "ampacity" | "conductor_temperature";
            /**
             * Entity
             * @description Saved object identity, or maximum for the hottest conductor.
             */
            entity: string;
            /**
             * Label
             * @description Engineering object label.
             */
            label: string;
            /**
             * Condition
             * @description Saved operating/rating basis, never inferred from target load.
             */
            condition: string;
            /**
             * Unit
             * @description SI unit; temperature relative differences use absolute K.
             * @enum {string}
             */
            unit: "A" | "K";
            /** Fem */
            fem: number | null;
            /** Iec */
            iec: number | null;
            /**
             * Delta
             * @description FEM minus IEC, A or K.
             */
            delta: number | null;
            /**
             * Relative Percent
             * @description 100*(FEM-IEC)/IEC; percent, temperature denominator in K.
             */
            relative_percent: number | null;
        };
        /** GenerateSpecification */
        GenerateSpecification: {
            /** Expected Revision */
            expected_revision: number;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Audience
             * @default customer
             * @enum {string}
             */
            audience?: "customer" | "internal";
            /**
             * Scope Acknowledged
             * @constant
             */
            scope_acknowledged: true;
        };
        /** GeometryPreview */
        GeometryPreview: {
            /**
             * Expected Revision
             * @description Saved workspace revision; preview does not save input.
             */
            expected_revision: number;
            /** @description Complete preview input; lengths m, temperatures K, RMS currents A. Dependent type coordinates follow the saved construction before full validation. */
            document: components["schemas"]["DraftDomainDocument"];
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
            /**
             * Human Confirmed
             * @default false
             */
            human_confirmed?: boolean;
        };
        /** Inbox */
        Inbox: {
            /** Items */
            items: components["schemas"]["InboxItem"][];
            /** Counts */
            counts: {
                [key: string]: number;
            };
            /** Source Errors */
            source_errors?: {
                [key: string]: unknown;
            }[];
        };
        /** InboxItem */
        InboxItem: {
            /**
             * Category
             * @enum {string}
             */
            category: "review" | "stale" | "missing" | "running";
            /**
             * Origin
             * @enum {string}
             */
            origin: "agent" | "document" | "asset" | "type" | "study" | "job" | "validation";
            /** Title */
            title: string;
            object: components["schemas"]["ObjectCard"];
            /** Reason */
            reason: string;
            /** Created */
            created: string | null;
        };
        /** IndexSource */
        IndexSource: {
            /** Kind */
            kind: string;
            /** Label */
            label: string;
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
            /** Standalone Parameter Schema */
            standalone_parameter_schema?: {
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
            /** X-Groups */
            "x-groups"?: {
                [key: string]: components["schemas"]["JsonValue"];
            }[];
            /** X-Headline */
            "x-headline"?: {
                [key: string]: components["schemas"]["JsonValue"];
            }[];
            /** Input Binding */
            input_binding?: {
                [key: string]: components["schemas"]["JsonValue"];
            } | null;
            /**
             * Preview
             * @default false
             */
            preview?: boolean;
            /** Preview Timeout S */
            preview_timeout_s?: number | null;
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
        /** InputPreflightIssue */
        InputPreflightIssue: {
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
            /**
             * Corrugation Depth
             * @description 皱纹金属护套波峰至波谷的径向深度，m；不含金属壁厚 thickness。
             */
            corrugation_depth?: number | null;
            /**
             * Corrugation Pitch
             * @description 相邻波峰的轴向节距，m；IEC 平均直径模型不据此推测纵向电阻修正。
             */
            corrugation_pitch?: number | null;
            /** Wire Count */
            wire_count?: number | null;
            /** Wire Diameter */
            wire_diameter?: number | null;
            /** Lay Length */
            lay_length?: number | null;
            /** Overlap */
            overlap?: number | null;
            /**
             * Mean Wire Diameter
             * @description 铠装单丝同截面正交两次测量的平均直径，m；非标称丝径
             */
            mean_wire_diameter?: number | null;
            /**
             * Padding Thickness
             * @description 绕包内衬层所含附加垫层厚度，m；已计入本层 thickness，不另累加
             */
            padding_thickness?: number | null;
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
             * @description 双带间隙绕包的最大轴向间隙，m
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
        /** Mapping */
        Mapping: {
            /** Name */
            name: string;
            /** Mapping */
            mapping: {
                [key: string]: number;
            };
            /** Headers */
            headers?: {
                [key: string]: string;
            };
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
            standard_kind?: ("copper_bare" | "copper_coated" | "aluminium" | "aluminium_alloy" | "steel_galvanized" | "steel_stainless_nonmagnetic" | "lead" | "XLPE" | "PVC" | "EPR" | "HEPR" | "other") | null;
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
        /** MaterialBindingItem */
        MaterialBindingItem: {
            /** Target Id */
            target_id: string;
            /**
             * Resource Id
             * Format: uuid
             */
            resource_id: string;
        };
        /** MaterialReferenceDraft */
        MaterialReferenceDraft: {
            /** Asset Id */
            asset_id: string;
            /** Version */
            version: string;
            /** Name */
            name: string;
            /** Selections */
            selections: components["schemas"]["MaterialSelection"][];
        };
        /** MaterialReferencePreview */
        MaterialReferencePreview: {
            /**
             * Workspace Id
             * Format: uuid
             */
            workspace_id: string;
            /** Expected Revision */
            expected_revision: number;
            /** Material Id */
            material_id: string;
            /**
             * Property
             * @enum {string}
             */
            property: "density" | "volumetric_heat_capacity" | "electrical_resistivity_20" | "relative_permittivity" | "thermal_resistivity";
            /**
             * Resource Id
             * Format: uuid
             */
            resource_id: string;
            /** Content Sha256 */
            content_sha256: string;
        };
        /** MaterialSelection */
        MaterialSelection: {
            /**
             * Parameter
             * @enum {string}
             */
            parameter: "density" | "volumetric_heat_capacity" | "electrical_resistivity_20" | "relative_permittivity" | "thermal_resistivity";
            selection: components["schemas"]["backend__kernel__resource_data__Selection"];
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
        /** MeasuredValue */
        MeasuredValue: {
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
            quantity: "r20" | "minimum_thickness" | "maximum_thickness" | "mean_thickness" | "minimum_tape_thickness" | "mean_wire_diameter" | "screen_area" | "minimum_overlap";
            /** Value */
            value: number;
            /**
             * Unit
             * @enum {string}
             */
            unit: "mm" | "mm2" | "ohm/km" | "%";
        };
        /** MeasurementReport */
        MeasurementReport: {
            /** Filename */
            filename: string;
            /** Content Base64 */
            content_base64: string;
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
        /** MemoryEdit */
        MemoryEdit: {
            /** Expected Revision */
            expected_revision: number;
            /** Content */
            content: string;
        };
        /** MemorySettings */
        MemorySettings: {
            /**
             * Enabled
             * @default false
             */
            enabled?: boolean;
            /**
             * Recall Limit
             * @default 5
             */
            recall_limit?: number;
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
        /** Message */
        Message: {
            /** Content */
            content: string;
            recipe?: components["schemas"]["RecipeRequest"] | null;
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
        /** MigrateResources */
        MigrateResources: {
            /** Expected Revision */
            expected_revision: number;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Operation
             * @default migrate_resource_bindings
             * @constant
             */
            operation?: "migrate_resource_bindings";
        };
        /** ModelReference */
        ModelReference: {
            /**
             * Id
             * @description Saved model identity or local cable type ID; not inferred from its name.
             */
            id: string | null;
            /** Name */
            name: string | null;
            /**
             * Version
             * @description Saved referenced model version; null for an unversioned local domain model.
             */
            version: string | null;
            /**
             * Content Sha256
             * @description Saved referenced model digest; null when there is no version binding.
             */
            content_sha256: string | null;
        };
        /** ModelSettingsTest */
        ModelSettingsTest: {
            /** Base Url */
            base_url?: string | null;
            /** Model */
            model?: string | null;
            /** Api Key */
            api_key?: string | null;
        };
        /** ModelSettingsUpdate */
        ModelSettingsUpdate: {
            /** Base Url */
            base_url: string;
            /** Model */
            model: string;
            /** Api Key */
            api_key?: string | null;
            /**
             * Instructions
             * @default
             */
            instructions?: string;
            /** Model Timeout S */
            model_timeout_s?: number | null;
            /** Context Window */
            context_window?: number | null;
            /** Max Output Tokens */
            max_output_tokens?: number | null;
        };
        /** NewModelIdentity */
        NewModelIdentity: {
            /**
             * Name
             * @description Human-selected new cable model name.
             */
            name: string;
            /** Manufacturer */
            manufacturer: string;
            /** Designation */
            designation: string;
            /**
             * Voltage V
             * @description Rated phase-to-phase voltage, V.
             */
            voltage_v: number;
            /**
             * U0 V
             * @description Rated phase-to-earth voltage, V.
             */
            u0_v: number;
            /**
             * Cores
             * @description Conductor core count, dimensionless.
             */
            cores: number;
            /**
             * Area M2
             * @description Nominal cross-sectional area per core, m².
             */
            area_m2: number;
            /**
             * Conductor
             * @enum {string}
             */
            conductor: "copper_bare" | "copper_coated" | "aluminium";
            /**
             * Identity Reference
             * @description Human-reviewed original page/fragment establishing manufacturer, designation, voltage, cores and material.
             */
            identity_reference: string;
        };
        /** NewType */
        NewType: {
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Origin
             * @enum {string}
             */
            origin: "library" | "standard" | "import" | "blank";
            /** Name */
            name: string;
            /** Construction */
            construction?: ("single_core" | "three_core" | "four_core") | null;
            /** Resource Id */
            resource_id?: string | null;
            /** Content Sha256 */
            content_sha256?: string | null;
            /** Proposal Id */
            proposal_id?: string | null;
            /**
             * Human Confirmed
             * @default false
             */
            human_confirmed?: boolean;
        };
        /** NewTypeProposal */
        NewTypeProposal: {
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /** Input */
            input: {
                [key: string]: unknown;
            };
        };
        /** ObjectCard */
        ObjectCard: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "project" | "study" | "type" | "cable_version" | "asset" | "run" | "job" | "delivery" | "plugin" | "validation" | "document" | "proposal" | "agent_task" | "input_snapshot";
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Version */
            version?: string | null;
            /** Revision */
            revision?: number | null;
            status: components["schemas"]["Status"];
            source?: components["schemas"]["IndexSource"] | null;
            /** Updated */
            updated: string | null;
            parent?: components["schemas"]["Parent"] | null;
            /** Subtype */
            subtype?: ("material" | "component" | "assembly" | "installation" | "study_template" | "rule" | "declared" | "reproduced") | null;
            validation?: components["schemas"]["ValidationEvidence"] | null;
        };
        /** ObjectList */
        ObjectList: {
            /** Items */
            items: components["schemas"]["ObjectCard"][];
            /** Total */
            total: number;
            /** Source Errors */
            source_errors?: {
                [key: string]: unknown;
            }[];
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
        /** Parent */
        Parent: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "project" | "study" | "type" | "cable_version" | "asset" | "run" | "job" | "delivery" | "plugin" | "validation" | "document" | "proposal" | "agent_task" | "input_snapshot";
            /** Id */
            id: string;
            /** Name */
            name: string;
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
        /** Pin */
        Pin: {
            /** Version */
            version?: string | null;
            /** Revision */
            revision?: number | null;
            /** Digest */
            digest?: string | null;
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
            issues?: components["schemas"]["InputPreflightIssue"][];
        } & {
            [key: string]: unknown;
        };
        /** PreflightIssue */
        PreflightIssue: {
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
            issues: components["schemas"]["PreflightIssue"][];
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
        /** Preview */
        Preview: {
            /**
             * Upload Id
             * Format: uuid
             */
            upload_id: string;
            /** Sheet */
            sheet: string;
            /** First Data Row */
            first_data_row: number;
            /** Mapping */
            mapping: {
                [key: string]: number;
            };
            series: components["schemas"]["SeriesDeclaration"];
        };
        /** PreviewComponent */
        PreviewComponent: {
            /**
             * Resource Id
             * Format: uuid
             */
            resource_id: string;
            /** Content Sha256 */
            content_sha256: string;
            /**
             * Workspace Id
             * Format: uuid
             */
            workspace_id: string;
            /** Expected Revision */
            expected_revision: number;
            target: components["schemas"]["ComponentSelection"];
            /** Target Material Id */
            target_material_id: string;
        };
        /** PreviewMaterialBindings */
        PreviewMaterialBindings: {
            /** Expected Revision */
            expected_revision: number;
            /** Items */
            items: components["schemas"]["MaterialBindingItem"][];
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
        /** PreviewRequest */
        PreviewRequest: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "specification" | "calculation" | "rating_table" | "research_report";
            source: components["schemas"]["SourceSelection"];
            document: components["schemas"]["DocumentMetadata"];
        };
        /** PreviewStudy */
        PreviewStudy: {
            /** Expected Revision */
            expected_revision: number;
            /** Expected Study Revision */
            expected_study_revision: number;
            /** Module */
            module?: string | null;
            /**
             * Domain
             * @description Unsaved SI domain draft. Never saved or approved by this operation.
             */
            domain?: {
                [key: string]: unknown;
            } | null;
            /** Parameters */
            parameters?: {
                [key: string]: unknown;
            } | null;
            /** Method Input */
            method_input?: {
                [key: string]: unknown;
            } | null;
        };
        /** PreviewStudyTemplate */
        PreviewStudyTemplate: {
            /**
             * Resource Id
             * Format: uuid
             */
            resource_id: string;
            /** Content Sha256 */
            content_sha256: string;
            /**
             * Workspace Id
             * Format: uuid
             */
            workspace_id: string;
            /** Expected Revision */
            expected_revision: number;
            /** Title */
            title: string;
            bindings: components["schemas"]["StudyBindings"];
        };
        /** ProblemContract */
        ProblemContract: {
            /**
             * Schema Version
             * @constant
             */
            schema_version: "cablesim.simulation-problem/1";
            /**
             * Schema
             * @description Exact Problem JSON Schema; no separate host physics model.
             */
            schema: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /**
             * Source
             * @description Repository-relative authoritative SDK module.
             */
            source: string;
            /** Source Sha256 */
            source_sha256: string;
            /** Schema Sha256 */
            schema_sha256: string;
            /**
             * Units
             * @description Units and positional meanings of fields; identifiers and flags have no physical units.
             */
            units: {
                [key: string]: string;
            };
        };
        /** ProjectScope */
        ProjectScope: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "project";
            /** Workspace Id */
            workspace_id: string;
        };
        /** Proposal */
        Proposal: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /** Title */
            title: string;
            /** Changes */
            changes: components["schemas"]["ProposalChange"][];
            /** Checks */
            checks: string[];
            /**
             * Assumptions
             * @description Declared method limits, separate from the operation effects.
             */
            assumptions?: string[];
            /**
             * Status
             * @default pending
             * @enum {string}
             */
            status?: "pending" | "approved" | "rejected";
            /** Kind */
            kind?: ("domain" | "parameters" | "study" | "type" | "draft_workflow" | "external_action") | null;
            /** Action */
            action?: string | null;
            /** Type Id */
            type_id?: string | null;
            /** Base Revision */
            base_revision?: number | null;
        };
        /** ProposalChange */
        ProposalChange: {
            /** Path */
            path: string;
            /** Label */
            label: string;
            before: components["schemas"]["JsonValue"];
            after: components["schemas"]["JsonValue"];
            /** Unit */
            unit?: string | null;
        };
        /** ProposalDecision */
        ProposalDecision: {
            /**
             * Status
             * @enum {string}
             */
            status: "approved" | "rejected";
            /** Receipt */
            receipt?: {
                [key: string]: components["schemas"]["JsonValue"];
            };
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
             * @description Existing immutable version to branch; omit when creating a new model.
             */
            target_model_id?: string | null;
            /** Expected Model Sha256 */
            expected_model_sha256?: string | null;
            /** @description Explicit new-model identity; creates no library record until human approval. */
            new_model?: components["schemas"]["NewModelIdentity"] | null;
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
            target_model_id: string | null;
            /** Base Sha256 */
            base_sha256: string | null;
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
            /** Um V */
            um_v?: number | null;
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
            dimension: "length" | "area" | "absolute_temperature" | "temperature_difference" | "linear_resistance" | "thermal_resistivity" | "thermal_conductivity" | "current" | "frequency" | "mass_density" | "resistivity" | "volumetric_heat_capacity" | "dimensionless";
        };
        /** QuantityResult */
        QuantityResult: {
            /**
             * Key
             * @description Stable physical quantity key declared by the plugin.
             */
            key: string;
            /**
             * Type
             * @description Plugin result type; quantity for scalar engineering values.
             */
            type: string;
            /**
             * Entity
             * @description Domain object ID to which this quantity belongs; no unit.
             */
            entity: string;
            /**
             * Unit
             * @description Physical unit of value; ampacity uses A (balanced RMS unless its basis states otherwise).
             */
            unit: string;
            /**
             * Status
             * @description Whether the producer supplied a valid value; unavailable is never zero.
             * @enum {string}
             */
            status: "available" | "unavailable";
            /**
             * Value
             * @description Numeric result in the declared unit; absent when unavailable.
             */
            value?: number | null;
            /**
             * Case
             * @description Result condition identity; rating versus rating-simultaneous must not be merged.
             */
            case?: string | null;
            /**
             * Reason
             * @description Producer error code, explanation and field location for an unavailable quantity.
             */
            reason?: {
                [key: string]: components["schemas"]["JsonValue"];
            } | null;
            /** @description Producer-declared ampacity meaning and fixed loads. Absent in historical outputs; do not infer a common rating from an unlabelled value. */
            rating_basis?: components["schemas"]["AmpacityBasis"] | null;
        } & {
            [key: string]: unknown;
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
            layout: "trefoil" | "flat" | "ducts" | "air" | "three_core_buried_single" | "three_core_buried_horizontal" | "three_core_ducts_horizontal";
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
            /**
             * Frequency Hz
             * @description 工况模板的明示交流频率 / Hz；不取型号草稿的直流占位回路
             * @default 50
             */
            frequency_hz?: number;
            /** Spacing M */
            spacing_m?: number | null;
            /**
             * Bonding
             * @default both_ends
             * @enum {string}
             */
            bonding?: "both_ends" | "single_point" | "unspecified";
            /**
             * Rating Basis
             * @description 多回路共同等负荷，或首回路变化而其他回路保持保存负荷；不同口径不可混用
             * @default simultaneous
             * @enum {string}
             */
            rating_basis?: "simultaneous" | "individual";
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
        /** RecalculateStudy */
        RecalculateStudy: {
            /**
             * Expected Revision
             * @description Expected workspace revision; no unit. Mismatch returns 409.
             */
            expected_revision: number;
            /**
             * Expected Study Revision
             * @description Expected study configuration revision; no unit.
             */
            expected_study_revision: number;
            /**
             * Request Id
             * Format: uuid
             * @description Idempotency key for both version adoption and the new run; retry unchanged after a disconnect.
             */
            request_id: string;
            /**
             * Module
             * @description Saved module to update and run; null selects the primary configuration.
             */
            module?: string | null;
            /**
             * Scope Acknowledged
             * @description Explicit user action adopts current versions and acknowledges method scope; preflight still runs.
             * @constant
             */
            scope_acknowledged: true;
        };
        /** RecipeInfo */
        RecipeInfo: {
            /**
             * Id
             * @enum {string}
             */
            id: "conclusion_summary" | "missing_inputs" | "proposal_comparison" | "sensitivity_advice" | "type_review" | "inbox_triage";
            /** Name */
            name: string;
            /** Description */
            description: string;
            /** Parameters */
            parameters: {
                [key: string]: components["schemas"]["JsonValue"];
            };
        };
        /** RecipeRequest */
        RecipeRequest: {
            /**
             * Id
             * @enum {string}
             */
            id: "conclusion_summary" | "missing_inputs" | "proposal_comparison" | "sensitivity_advice" | "type_review" | "inbox_triage";
            /** Parameters */
            parameters?: {
                [key: string]: components["schemas"]["JsonValue"];
            };
        };
        /**
         * ReferenceEvidence
         * @description Frozen lookup receipt; an internally consistent receipt is not approval.
         *
         *     Adoption rechecks its exact identity against the installed sealed provider.
         *     Keeping this separate from source prose preserves every condition and limit.
         */
        ReferenceEvidence: {
            /**
             * Schema Version
             * @default cablesim.resource-reference/1
             * @constant
             */
            schema_version?: "cablesim.resource-reference/1";
            /** Parameter */
            parameter: string;
            quantity: components["schemas"]["Quantity"];
            /** Selection */
            selection: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /** Receipt */
            receipt: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /** Record Sha256 */
            record_sha256: string;
        };
        /** RefineRequest */
        RefineRequest: {
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Source Run Id
             * Format: uuid
             */
            source_run_id: string;
            /**
             * Max Core Hours
             * @default 12
             */
            max_core_hours?: number;
            /**
             * Max Steps
             * @default 8
             */
            max_steps?: number;
            /**
             * Tolerance K
             * @default 0.1
             */
            tolerance_k?: number;
            /**
             * Budget Confirmed
             * @default false
             */
            budget_confirmed?: boolean;
            /** Max Nodes */
            max_nodes?: number | null;
            /**
             * Upgrade Method
             * @default false
             */
            upgrade_method?: boolean;
            /**
             * Temperature Only Levels
             * @default true
             */
            temperature_only_levels?: boolean;
            /**
             * Calculate Final Rating
             * @default false
             */
            calculate_final_rating?: boolean;
            /** Continue From */
            continue_from?: string | null;
            /**
             * Minimum Domain Levels
             * @description Minimum doubled-domain validation levels before final rating; never relaxes the two-change threshold.
             * @default 2
             */
            minimum_domain_levels?: number;
            /**
             * Retain Domain Levels
             * @description Continue on a verified converged domain prefix; retain later validation as history.
             */
            retain_domain_levels?: number | null;
        };
        /** Relation */
        Relation: {
            /** Role */
            role: string;
            target: components["schemas"]["ObjectCard"];
            pinned?: components["schemas"]["Pin"] | null;
            /**
             * Freshness
             * @enum {string}
             */
            freshness: "current" | "outdated" | "unknown";
            /** Reason */
            reason?: string | null;
        };
        /** Relations */
        Relations: {
            /** Uses */
            uses: components["schemas"]["Relation"][];
            /** Used By */
            used_by: components["schemas"]["Relation"][];
            /** Unresolved */
            unresolved?: components["schemas"]["Unresolved"][];
            /** Source Errors */
            source_errors?: {
                [key: string]: unknown;
            }[];
        };
        /** ReleaseExclusion */
        ReleaseExclusion: {
            /** Check Id */
            check_id: string;
            /** Reason */
            reason: string;
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
        /** ReleaseScope */
        ReleaseScope: {
            /** Expected Revision */
            expected_revision: number;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /** Specification Digest */
            specification_digest: string;
            /**
             * Human Confirmed
             * @constant
             */
            human_confirmed: true;
            /** Exclusions */
            exclusions: components["schemas"]["ReleaseExclusion"][];
        };
        /** RemoteExecution */
        RemoteExecution: {
            /**
             * Backend
             * @constant
             */
            backend: "slurm";
            /**
             * State
             * @description Cached scheduler phase: preparing/submitted/queued/running/collecting, then the saved run terminal state. Not inferred from host running status.
             */
            state: string;
            /** Job Id */
            job_id?: string | null;
            /** Plan Id */
            plan_id?: string | null;
            /** Slurm States */
            slurm_states?: string[];
            /** Actual Cpu Seconds */
            actual_cpu_seconds?: number | null;
            /** Updated */
            updated?: string | null;
        } & {
            [key: string]: unknown;
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
        /** ResolveBasis */
        ResolveBasis: {
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /** Expected Revision */
            expected_revision: number;
        };
        /**
         * ResourceApplication
         * @description Frozen input reference, never an executable or an approval certificate.
         *
         *     The application services additionally validate the typed payload against the
         *     frozen input and the installed method before it can be adopted. Transport
         *     keeps the complete source rather than a display-only source sentence.
         */
        ResourceApplication: {
            /**
             * Schema Version
             * @default cablesim.resource-application/1
             * @constant
             */
            schema_version?: "cablesim.resource-application/1";
            /**
             * Capture Version
             * @default 1.0.0
             * @constant
             */
            capture_version?: "1.0.0";
            /**
             * Kind
             * @enum {string}
             */
            kind: "component" | "study_template";
            /** Method */
            method: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /** Source */
            source: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /** Payload */
            payload: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /** Payload Sha256 */
            payload_sha256: string;
        };
        /** RestoreInfo */
        RestoreInfo: {
            /**
             * Status
             * @description Restore phase; pending_restart has not replaced the active database.
             * @enum {string}
             */
            status: "pending_restart" | "restored" | "none";
            /**
             * Request Id
             * @description Restore request identity; no unit.
             */
            request_id?: string | null;
            /**
             * Backup Id
             * @description Selected backup identity; no unit.
             */
            backup_id?: string | null;
            /**
             * Sha256
             * @description Selected backup SHA256.
             */
            sha256?: string | null;
            /**
             * Safety Snapshot
             * @description Pre-restore safety snapshot, recorded after the restart restore.
             */
            safety_snapshot?: string | null;
            /**
             * Finished
             * @description UTC restore completion timestamp.
             */
            finished?: string | null;
        };
        /** RestoreRequest */
        RestoreRequest: {
            /**
             * Request Id
             * Format: uuid
             * @description Idempotency key; repeat to reuse the same completed backup. No unit.
             */
            request_id: string;
            /**
             * Backup Id
             * Format: uuid
             * @description Backup ID returned by the backup endpoint; no unit.
             */
            backup_id: string;
            /**
             * Sha256
             * @description Reviewed SHA256 of the backup to restore.
             */
            sha256: string;
            /**
             * Confirm Replace
             * @description Explicit acknowledgement that restart will replace the entire current engineering library.
             */
            confirm_replace: boolean;
        };
        /** ResultSelector */
        ResultSelector: {
            /**
             * Key
             * @description Physical quantity key to select, such as ampacity.
             */
            key: string;
            /**
             * Entity
             * @description Exact domain object ID to select; no unit.
             */
            entity: string;
            /**
             * Unit
             * @description Exact quantity unit to match, such as A.
             */
            unit: string;
            /**
             * Case
             * @description Exact producer result condition; omitted only when the producer has no condition identifier.
             */
            case?: string | null;
        } & {
            [key: string]: unknown;
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
        /** Revise */
        Revise: {
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /** Expected Version */
            expected_version: number;
            /** Expected Revision */
            expected_revision: number;
            /** Note */
            note: string;
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
        /** RunCase */
        RunCase: {
            /** Case Id */
            case_id: string;
            /** Status */
            status: string;
            /** Results */
            results: components["schemas"]["QuantityResult"][];
            /** Artifacts */
            artifacts: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /** Error */
            error?: {
                [key: string]: components["schemas"]["JsonValue"];
            } | null;
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
        /** RunCaseInput */
        RunCaseInput: {
            /**
             * Run Id
             * Format: uuid
             */
            run_id: string;
            /** Case Id */
            case_id: string;
            /**
             * Input
             * @description Exact immutable accepted case input, never the current workspace.
             */
            input: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /**
             * Input Digest
             * @description Canonical SHA256 of this case input.
             */
            input_digest: string;
            /**
             * Run Input Digest
             * @description Canonical SHA256 of the full accepted run snapshot.
             */
            run_input_digest: string;
            /**
             * Integrity
             * @constant
             */
            integrity: "verified";
        } & {
            [key: string]: unknown;
        };
        /** RunDetailResponse */
        RunDetailResponse: {
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
            /** @description Saved typed quantities and verified artifacts; absent while running. */
            output: components["schemas"]["RunOutput"] | null;
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
            /** @description Dynamic method/model version differences, outside the immutable result digest. */
            version_status?: components["schemas"]["VersionStatus"] | null;
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
            execution?: components["schemas"]["RemoteExecution"] | null;
            /**
             * Snapshot View
             * @description Response projection only. Each snapshot case has input_ref instead of input; input_digest still identifies the full stored snapshot, which was verified before projection. Use view=full for the unchanged complete response.
             * @constant
             */
            snapshot_view: "inputs-on-demand";
        } & {
            [key: string]: unknown;
        };
        /** RunOutput */
        RunOutput: {
            /** Cases */
            cases: components["schemas"]["RunCase"][];
            /** @description Default sweep quantity identity; match all four keys, never choose the first ampacity. Missing results remain gaps. */
            default_result?: components["schemas"]["ResultSelector"] | null;
        } & {
            [key: string]: unknown;
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
        /** RunPin */
        RunPin: {
            /** Run Id */
            run_id: string;
            /** Input Digest */
            input_digest: string;
            /** Output Digest */
            output_digest: string;
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
            /** @description Saved typed quantities and verified artifacts; absent while running. */
            output: components["schemas"]["RunOutput"] | null;
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
            /** @description Dynamic method/model version differences, outside the immutable result digest. */
            version_status?: components["schemas"]["VersionStatus"] | null;
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
            execution?: components["schemas"]["RemoteExecution"] | null;
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
        /** RunSummary */
        RunSummary: {
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
             * Status
             * @enum {string}
             */
            status: "accepted" | "running" | "validating" | "succeeded" | "partial" | "failed" | "interrupted";
            /** Created */
            created: string;
            /** Finished */
            finished: string | null;
            /**
             * Freshness
             * @enum {string}
             */
            freshness: "current" | "historical" | "unknown";
            /**
             * Integrity
             * @enum {string}
             */
            integrity: "verified" | "corrupt";
            version_status: components["schemas"]["VersionStatus"] | null;
            snapshot: components["schemas"]["RunSummarySnapshot"];
            /** @description Exact saved method release; null when the snapshot integrity cannot be established. */
            method: components["schemas"]["Method"] | null;
            /**
             * Task
             * @description Task frozen in this accepted run; absent in older snapshots or when integrity fails. Never taken from the current study.
             */
            task?: string | null;
            /**
             * Driver
             * @description Saved run driver and its SI parameters; null when historical input does not declare one or integrity fails.
             */
            driver?: {
                [key: string]: components["schemas"]["JsonValue"];
            } | null;
            /**
             * Headline
             * @description Producer-supplied conclusion from the saved successful case evidence, with quantity/unit/condition. The host selects the same verified case as its headline witness; no client inference. Null when unavailable.
             */
            headline?: string | null;
            /**
             * Error
             * @description Saved run-level error code and message, each limited to 512 characters; full detail remains at GET runs/{rid}.
             */
            error: {
                [key: string]: string;
            } | null;
            /**
             * Headlines
             * @description Up to three producer-declared answers from verified sealed output; SI value and display conversion, entity, condition and same-case artifact digest. Empty when unavailable; no defaults.
             */
            headlines?: {
                [key: string]: components["schemas"]["JsonValue"];
            }[];
        };
        /** RunSummaryPage */
        RunSummaryPage: {
            /** Items */
            items: components["schemas"]["RunSummary"][];
            /** Next Cursor */
            next_cursor: number | null;
        };
        /** RunSummarySnapshot */
        RunSummarySnapshot: {
            /**
             * Module
             * @description Saved selected module; null means the root study configuration.
             */
            module: string | null;
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
            document: components["schemas"]["DraftDomainDocument"];
        };
        /** SaveMeasurements */
        SaveMeasurements: {
            /** Expected Revision */
            expected_revision: number;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Origin
             * @enum {string}
             */
            origin: "manufacturer" | "teaching";
            /** Sample Id */
            sample_id: string;
            /**
             * Measured On
             * Format: date
             */
            measured_on: string;
            /** Method */
            method: string;
            /** Reference */
            reference: string;
            /** Values */
            values: components["schemas"]["MeasuredValue"][];
            report?: components["schemas"]["MeasurementReport"] | null;
            /**
             * Acknowledge Measured
             * @constant
             */
            acknowledge_measured: true;
        };
        /** SaveTypeDocument */
        SaveTypeDocument: {
            /** Expected Revision */
            expected_revision: number;
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Operation
             * @default save_type_document
             * @constant
             */
            operation?: "save_type_document";
            /** Document */
            document: {
                [key: string]: unknown;
            };
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
        /**
         * SectionReportImage
         * @description Presentation only: calculated values remain in the saved source run.
         */
        SectionReportImage: {
            /**
             * Run Id
             * Format: uuid
             * @description Saved source run identity; no unit.
             */
            run_id: string;
            /**
             * Case Id
             * @description Saved successful case identity.
             */
            case_id: string;
            /**
             * Section Id
             * @description Section identity in that case input.
             */
            section_id: string;
            /**
             * Input Digest
             * @description SHA256 of the immutable run input snapshot.
             */
            input_digest: string;
            /**
             * Width
             * @description PNG width, pixels.
             */
            width: number;
            /**
             * Height
             * @description PNG height, pixels.
             */
            height: number;
            /**
             * Png Base64
             * @description Light-paper section PNG from the workbench drawing; at most 8 MiB decoded.
             */
            png_base64: string;
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
            /** Series Ids */
            series_ids: string[];
            /**
             * Format
             * @default json
             * @enum {string}
             */
            format?: "json" | "xlsx";
        };
        /** Selection */
        "Selection-Output": {
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
        /** SeriesDeclaration */
        SeriesDeclaration: {
            /** Name */
            name: string;
            /** Manufacturer */
            manufacturer: string;
            /** Designation */
            designation: string;
            /** Cores */
            cores: number;
            /** U0 V */
            u0_v: number;
            /** U V */
            u_v: number;
            /** Um V */
            um_v?: number | null;
            /**
             * Origin
             * @default factory
             * @enum {string}
             */
            origin?: "factory" | "public" | "demo";
            /** Standards */
            standards?: string[];
            /** Common */
            common?: {
                [key: string]: number;
            };
            /** Common Basis */
            common_basis?: {
                [key: string]: string;
            };
            /** Modelling */
            modelling?: {
                [key: string]: components["schemas"]["DeclaredParameter"];
            };
            /** Source */
            source?: {
                [key: string]: unknown;
            };
            /** Reference */
            reference?: {
                [key: string]: unknown;
            };
            /**
             * Resistance Basis
             * @default stated
             * @enum {string}
             */
            resistance_basis?: "stated" | "standard_limit";
            /** Conductor */
            conductor?: ("copper" | "aluminium") | null;
            /** Insulation */
            insulation?: ("XLPE" | "PVC") | null;
            /** Metal Sheath */
            metal_sheath?: ("lead" | "corrugated_aluminium" | "smooth_aluminium") | null;
            /** Oversheath */
            oversheath?: ("PVC" | "PE") | null;
            /** Armour Material */
            armour_material?: string | null;
            /** Outer Diameter Precision Mm */
            outer_diameter_precision_mm?: number | null;
            /** Material Properties */
            material_properties?: {
                [key: string]: {
                    [key: string]: components["schemas"]["DeclaredParameter"];
                };
            };
        };
        /** SeriesScope */
        SeriesScope: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "series";
            /** Series Name */
            series_name: string;
            /** Workspace Ids */
            workspace_ids: string[];
        };
        /** SessionContext */
        SessionContext: {
            /**
             * Kind
             * @enum {string}
             */
            kind: "project" | "type";
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Default Proposal Kind
             * @enum {string}
             */
            default_proposal_kind: "domain" | "type";
            /** Default Recipe */
            default_recipe?: "type_review" | null;
        };
        /** SessionId */
        SessionId: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            context?: components["schemas"]["SessionContext"] | null;
        };
        /** SessionRecord */
        SessionRecord: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Workspace Id
             * Format: uuid
             */
            workspace_id: string;
            /** Study Id */
            study_id: string | null;
            context?: components["schemas"]["SessionContext"] | null;
            /** Workspace Revision */
            workspace_revision: number;
            /** Study Revision */
            study_revision: number | null;
            /**
             * State
             * @enum {string}
             */
            state: "created" | "planning" | "running" | "waiting" | "reviewing" | "completed" | "blocked" | "failed" | "cancelled";
            /** Waiting Reason */
            waiting_reason: ("missing_input" | "scope_confirmation" | "external_job" | "capability" | "budget" | "human_review") | null;
            /** Created */
            created: string;
            /** Updated */
            updated: string;
            /** Budget */
            budget: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /** Messages */
            messages: {
                [key: string]: components["schemas"]["JsonValue"];
            }[];
            /** Tool Calls */
            tool_calls: {
                [key: string]: components["schemas"]["JsonValue"];
            }[];
            /** Results */
            results: {
                [key: string]: components["schemas"]["JsonValue"];
            }[];
            /** Proposals */
            proposals: components["schemas"]["Proposal"][];
            /** Plans */
            plans: {
                [key: string]: components["schemas"]["JsonValue"];
            }[];
            /** Steps */
            steps: {
                [key: string]: components["schemas"]["JsonValue"];
            }[];
            /** Events */
            events: components["schemas"]["AuditEvent"][];
            /** Enabled Tools */
            enabled_tools?: string[];
        };
        /** SessionSummary */
        SessionSummary: {
            /**
             * Id
             * Format: uuid
             */
            id: string;
            /**
             * Workspace Id
             * Format: uuid
             */
            workspace_id: string;
            /** Study Id */
            study_id: string | null;
            /**
             * State
             * @enum {string}
             */
            state: "created" | "planning" | "running" | "waiting" | "reviewing" | "completed" | "blocked" | "failed" | "cancelled";
            /** Waiting Reason */
            waiting_reason: ("missing_input" | "scope_confirmation" | "external_job" | "capability" | "budget" | "human_review") | null;
            /** Title */
            title: string;
            /** Created */
            created: string;
            /** Updated */
            updated: string;
            /** Pending Proposals */
            pending_proposals: number;
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
        /** SnapshotInfo */
        SnapshotInfo: {
            /**
             * Id
             * @description Backup identity; not a filesystem path.
             */
            id: string;
            /**
             * Schema Version
             * @description SQLite user_version supported by this host; no unit.
             */
            schema_version: number;
            /**
             * Sha256
             * @description SHA256 of the standalone SQLite snapshot.
             */
            sha256: string;
            /**
             * Size Bytes
             * @description Snapshot file size, bytes.
             */
            size_bytes: number;
            /**
             * Created
             * @description UTC creation timestamp.
             */
            created: string;
            /**
             * Download Url
             * @description Host URL for the verified snapshot download.
             */
            download_url: string;
        };
        /** SnapshotRequest */
        SnapshotRequest: {
            /**
             * Request Id
             * Format: uuid
             * @description Idempotency key; repeat to reuse the same completed backup. No unit.
             */
            request_id: string;
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
            kind: "manufacturer" | "standard" | "literature" | "project_input" | "derived";
            /** Reference */
            reference: string;
            /** Reviewed */
            reviewed: boolean;
        };
        /** SourceSelection */
        SourceSelection: {
            /** Workspace Id */
            workspace_id: string;
            /** Expected Revision */
            expected_revision: number;
            /** Specification Digest */
            specification_digest?: string | null;
            /** Runs */
            runs?: components["schemas"]["RunPin"][];
        };
        /** Status */
        Status: {
            /** Code */
            code: string;
            /** Label */
            label: string;
            /** Reason */
            reason?: string | null;
        };
        /** StepRequest */
        StepRequest: {
            /**
             * Request Id
             * Format: uuid
             */
            request_id: string;
            /**
             * Source Run Id
             * Format: uuid
             */
            source_run_id: string;
            /** Capacities */
            capacities?: {
                [key: string]: unknown;
            } | null;
            /** Controls */
            controls?: {
                [key: string]: unknown;
            };
            /**
             * Max Core Hours
             * @default 16
             */
            max_core_hours?: number;
            /**
             * Budget Confirmed
             * @default false
             */
            budget_confirmed?: boolean;
            /** Preload */
            preload?: boolean | null;
            /** History */
            history?: {
                [key: string]: unknown;
            }[] | null;
        };
        /** StudyBindings */
        StudyBindings: {
            /** Cable Type Ids */
            cable_type_ids: string[];
            /** Circuit Ids */
            circuit_ids: string[];
            /** Cable Ids */
            cable_ids: string[];
        };
        /** StudyCardResponse */
        StudyCardResponse: {
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
            /**
             * Definition
             * @description Display projection only: task/method identity, driver kind and input schema. Full immutable inputs remain at input_ref.
             */
            definition: {
                [key: string]: components["schemas"]["JsonValue"];
            };
            /**
             * Created
             * @description UTC configuration timestamp.
             */
            created: string;
            /**
             * Can Undo
             * @description Earlier study configuration exists; separate from workspace structure history.
             * @default false
             */
            can_undo?: boolean;
            /**
             * Can Redo
             * @description Later configuration on the active history branch exists.
             * @default false
             */
            can_redo?: boolean;
            /**
             * Latest Run Id
             * @description Most recently accepted run; null before first execution.
             */
            latest_run_id?: string | null;
            /** @description Verified latest-run status and producer headlines from the same read snapshot. No history, full field arrays or physical recalculation; null before execution. */
            latest_run?: components["schemas"]["RunSummary"] | null;
            /**
             * Latest Module Run Ids
             * @description Latest saved run ID per configured module, from this read snapshot; allows on-demand module reads without loading history.
             */
            latest_module_run_ids?: {
                [key: string]: string;
            };
            /** @description Version status of latest_run_id, computed at read time. */
            version_status?: components["schemas"]["VersionStatus"] | null;
            /**
             * Workspace Revision
             * @description Current workspace revision for this read.
             */
            readonly workspace_revision?: number | null;
            /** @description Model display identity from the saved workspace binding or local domain; null for standalone study input. Does not load the complete workspace payload. */
            readonly model_reference?: components["schemas"]["ModelReference"] | null;
            /**
             * Definition Digest
             * @description SHA256 of the complete saved study definition before projection.
             */
            definition_digest: string;
            /**
             * Input Ref
             * @description Endpoint for the complete editable study configuration; cards must never be saved as input.
             */
            input_ref: string;
        } & {
            [key: string]: unknown;
        };
        /** StudyConfiguration */
        "StudyConfiguration-Input": {
            /** Title */
            title: string;
            /**
             * Task
             * @description Study objective; simulation tasks submit asynchronously to Slurm.
             */
            task?: ("rating" | "operating" | "target" | "transient-temperature" | "sheath-losses" | "electrothermal-steady" | "iec-fem-comparison") | null;
            method: components["schemas"]["Method"];
            /**
             * Input Source
             * @default domain
             * @enum {string}
             */
            input_source?: "domain" | "study";
            /**
             * Method Input
             * @description Saved standalone plugin input. For cablesim.simulation-problem/1 use the exact GET /api/simulation/problem-contract schema; all lengths m, absolute temperature K, RMS current A.
             */
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
            task?: ("rating" | "operating" | "target" | "transient-temperature" | "sheath-losses" | "electrothermal-steady" | "iec-fem-comparison") | null;
            method: components["schemas"]["Method"];
            /**
             * Input Source
             * @default domain
             * @enum {string}
             */
            input_source?: "domain" | "study";
            /**
             * Method Input
             * @description Saved standalone plugin input. For cablesim.simulation-problem/1 use the exact GET /api/simulation/problem-contract schema; all lengths m, absolute temperature K, RMS current A.
             */
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
            task?: ("rating" | "operating" | "target" | "transient-temperature" | "sheath-losses" | "electrothermal-steady" | "iec-fem-comparison") | null;
            method: components["schemas"]["Method"];
            /**
             * Input Source
             * @default domain
             * @enum {string}
             */
            input_source?: "domain" | "study";
            /**
             * Method Input
             * @description Saved standalone plugin input. For cablesim.simulation-problem/1 use the exact GET /api/simulation/problem-contract schema; all lengths m, absolute temperature K, RMS current A.
             */
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
        /** StudyHistoryRequest */
        StudyHistoryRequest: {
            /**
             * Expected Revision
             * @description Workspace revision; no unit. Structure is not changed.
             */
            expected_revision: number;
            /**
             * Expected Study Revision
             * @description Current study revision; restores create a new monotonic revision.
             */
            expected_study_revision: number;
            /**
             * Request Id
             * Format: uuid
             * @description Idempotency key; retries with the same body return the original restore.
             */
            request_id: string;
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
            /**
             * Can Undo
             * @description Earlier study configuration exists; separate from workspace structure history.
             * @default false
             */
            can_undo?: boolean;
            /**
             * Can Redo
             * @description Later configuration on the active history branch exists.
             * @default false
             */
            can_redo?: boolean;
            /**
             * Latest Run Id
             * @description Most recently accepted run; null before first execution.
             */
            latest_run_id?: string | null;
            /** @description Verified latest-run status and producer headlines from the same read snapshot. No history, full field arrays or physical recalculation; null before execution. */
            latest_run?: components["schemas"]["RunSummary"] | null;
            /**
             * Latest Module Run Ids
             * @description Latest saved run ID per configured module, from this read snapshot; allows on-demand module reads without loading history.
             */
            latest_module_run_ids?: {
                [key: string]: string;
            };
            /** @description Version status of latest_run_id, computed at read time. */
            version_status?: components["schemas"]["VersionStatus"] | null;
            /**
             * Workspace Revision
             * @description Current workspace revision for this read.
             */
            readonly workspace_revision?: number | null;
            /** @description Model display identity from the saved workspace binding or local domain; null for standalone study input. Does not load the complete workspace payload. */
            readonly model_reference?: components["schemas"]["ModelReference"] | null;
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
            /** Change Summary */
            change_summary?: string | null;
            /** Author */
            author?: string | null;
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
        /** ToolInfo */
        ToolInfo: {
            /** Name */
            name: string;
            /** Title */
            title: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "read" | "propose" | "run";
            /** Description */
            description: string;
            /** Plugin Id */
            plugin_id?: string | null;
            /** Hpc */
            hpc: boolean;
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
            /**
             * Human Confirmed
             * @default false
             */
            human_confirmed?: boolean;
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
        /** Unresolved */
        Unresolved: {
            /** Role */
            role: string;
            /**
             * Freshness
             * @default unknown
             * @constant
             */
            freshness?: "unknown";
            /** Reason */
            reason: string;
        };
        /** UpdateStudy */
        UpdateStudy: {
            /** Title */
            title: string;
            /**
             * Task
             * @description Study objective; simulation tasks submit asynchronously to Slurm.
             */
            task?: ("rating" | "operating" | "target" | "transient-temperature" | "sheath-losses" | "electrothermal-steady" | "iec-fem-comparison") | null;
            method: components["schemas"]["Method"];
            /**
             * Input Source
             * @default domain
             * @enum {string}
             */
            input_source?: "domain" | "study";
            /**
             * Method Input
             * @description Saved standalone plugin input. For cablesim.simulation-problem/1 use the exact GET /api/simulation/problem-contract schema; all lengths m, absolute temperature K, RMS current A.
             */
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
        /** UpgradeStudyMethods */
        UpgradeStudyMethods: {
            /** Expected Revision */
            expected_revision: number;
            /** Expected Study Revision */
            expected_study_revision: number;
            /**
             * Module
             * @description Null upgrades primary and all modules, including crosschecks and candidate completions; never creates a run.
             */
            module?: string | null;
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
        /** ValidationEvidence */
        ValidationEvidence: {
            /** Snapshot Digest */
            snapshot_digest: string;
            /** Citation */
            citation: string;
            /** Reference Location */
            reference_location: string;
            /** Source Pages */
            source_pages: {
                [key: string]: unknown;
            }[];
            /** Scope */
            scope: string;
            /** Metrics */
            metrics: components["schemas"]["ValidationMetric"][];
            /** Total Metrics */
            total_metrics: number;
            /** Outside Tolerance */
            outside_tolerance: number;
            /** Convergence Passed */
            convergence_passed?: boolean | null;
            /** Limitations */
            limitations: string[];
            /** Runs */
            runs: {
                [key: string]: unknown;
            }[];
            /** Report Tolerance */
            report_tolerance?: {
                [key: string]: unknown;
            } | null;
        };
        /** ValidationMetric */
        ValidationMetric: {
            /** Id */
            id: string;
            /** Variant */
            variant: string;
            /** Quantity */
            quantity: string;
            /** Unit */
            unit?: string | null;
            /** Reference */
            reference?: number | null;
            /** Open Source */
            open_source?: number | null;
            /** Comsol */
            comsol?: number | null;
            /** Difference */
            difference?: number | null;
            /** Relative Difference */
            relative_difference?: number | null;
            /** Relative Difference Percent */
            relative_difference_percent?: number | null;
            /** Status */
            status: string;
            /** Source */
            source?: string | {
                [key: string]: unknown;
            } | null;
            /** Tolerance */
            tolerance?: {
                [key: string]: unknown;
            } | null;
        };
        /** VersionChange */
        VersionChange: {
            /**
             * Kind
             * @description Changed installed method or referenced model family; no unit.
             * @enum {string}
             */
            kind: "method" | "model";
            /**
             * Code
             * @description METHOD_VERSION_CHANGED, METHOD_UNAVAILABLE, MODEL_VERSION_CHANGED or informational METHOD_PRESENTATION_UPDATED.
             */
            code: string;
            /**
             * Id
             * @description Stable plugin ID or model family ID, never a display-name match.
             */
            id: string;
            /**
             * From Version
             * @description Version frozen in the source run.
             */
            from_version: string;
            /**
             * To Version
             * @description Installed plugin or latest published model version; null if unavailable.
             */
            to_version: string | null;
            /**
             * From Digest
             * @description Frozen release/content SHA256.
             */
            from_digest: string;
            /**
             * To Digest
             * @description Current release/content SHA256; detects changes even at the same version.
             */
            to_digest: string | null;
            /**
             * Message
             * @description Display-ready version difference.
             */
            message: string;
            /**
             * Classification
             * @description Proven release change class. Missing historical sealed manifest fails closed as unproven.
             */
            classification?: ("presentation_only" | "calculation_changed" | "unproven") | null;
            /**
             * Rule
             * @description Versioned rule used to compare method version, sealed files/dependencies and executable contracts; no unit.
             */
            rule?: string | null;
            /**
             * From Computation Digest
             * @description SHA256 of historical computation identity under rule; null when evidence is absent.
             */
            from_computation_digest?: string | null;
            /**
             * To Computation Digest
             * @description SHA256 of current computation identity under rule; equality proves presentation-only changes after both release digests are verified.
             */
            to_computation_digest?: string | null;
        } & {
            [key: string]: unknown;
        };
        /** VersionStatus */
        VersionStatus: {
            /**
             * Status
             * @description Version comparison only; execution status and input freshness are separate.
             * @enum {string}
             */
            status: "current" | "stale" | "empty";
            /** Reasons */
            reasons?: components["schemas"]["VersionChange"][];
            /**
             * Notices
             * @description Informational presentation-only release changes; do not make the saved result stale. Clients may acknowledge once per new release digest.
             */
            notices?: components["schemas"]["VersionChange"][];
            /**
             * Display Name
             * @description One combined status message for the result or document cover.
             */
            display_name: string;
        } & {
            [key: string]: unknown;
        };
        /** Selection */
        backend__kernel__datasheet_contracts__Selection: {
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
        /** Selection */
        backend__kernel__resource_data__Selection: {
            /** Release Digest */
            release_digest: string;
            /** Data Sha256 */
            data_sha256: string;
            /** Standard */
            standard: string;
            /** Edition */
            edition: string;
            /** Locator */
            locator: string;
            /** Quantity */
            quantity: string;
            /** Record Id */
            record_id: string;
            /** Conditions */
            conditions: {
                [key: string]: components["schemas"]["JsonValue"];
            };
        };
        CableModelVersion: components["schemas"]["CableModelVersion-Input"];
        CableType: components["schemas"]["CableType-Input"];
        Circuit: components["schemas"]["Circuit-Input"];
        CoupledParameters: components["schemas"]["CoupledParameters-Input"];
        DomainDocument: components["schemas"]["DomainDocument-Input"];
        ExtractionScope: components["schemas"]["ExtractionScope-Input"];
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
            header?: {
                "x-cablesim-actor"?: string | null;
            };
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
            header?: {
                "x-cablesim-actor"?: string | null;
            };
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
            header?: {
                "x-cablesim-actor"?: string | null;
            };
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
            header?: {
                "x-cablesim-actor"?: string | null;
            };
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
            query?: {
                view?: "full" | "summary";
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
    plugin_asset_api_plugins__plugin_id__assets__role__get: {
        parameters: {
            query?: {
                sha256?: string | null;
            };
            header?: never;
            path: {
                plugin_id: string;
                role: "cover" | "method" | "validation";
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
            query?: {
                view?: "full" | "summary";
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
                    "application/json": components["schemas"]["StudyResponse"][] | components["schemas"]["StudyCardResponse"][];
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
    direct_study_detail_api_studies__sid__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
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
                    "application/json": components["schemas"]["StudyResponse"];
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
    study_detail_api_workspaces__wid__studies__sid__get: {
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
                    "application/json": components["schemas"]["StudyResponse"];
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
    recalculate_api_workspaces__wid__studies__sid__recalculate_post: {
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
                "application/json": components["schemas"]["RecalculateStudy"];
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
            /** @description Accepted current-version run; poll Location. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunResponse"];
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
    preview_api_workspaces__wid__studies__sid__preview_post: {
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
                "application/json": components["schemas"]["PreviewStudy"];
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
    upgrade_methods_api_workspaces__wid__studies__sid__upgrade_methods_post: {
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
                "application/json": components["schemas"]["UpgradeStudyMethods"];
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
    undo_api_workspaces__wid__studies__sid__undo_post: {
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
                "application/json": components["schemas"]["StudyHistoryRequest"];
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
    redo_api_workspaces__wid__studies__sid__redo_post: {
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
                "application/json": components["schemas"]["StudyHistoryRequest"];
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
                /** @description full preserves the complete saved output and snapshot. summary returns list metadata, method identity and snapshot.module only; pagination and integrity/currentness semantics are unchanged. */
                view?: "full" | "summary";
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
                    "application/json": components["schemas"]["RunPage"] | components["schemas"]["RunSummaryPage"];
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
            query?: {
                /** @description detail returns the working result and display mesh, deferring verbose material basis, preflight and manifests via evidence_ref. evidence includes those disclosures but defers case inputs and lossless field shards. full returns unchanged complete evidence. All verify the original stored input and output before projecting. */
                view?: "detail" | "evidence" | "full";
            };
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
                    "application/json": components["schemas"]["RunResponse"] | components["schemas"]["RunDetailResponse"];
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
    run_case_input_api_workspaces__wid__studies__sid__runs__rid__cases__case_id__input_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                sid: string;
                rid: string;
                case_id: string;
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
                    "application/json": components["schemas"]["RunCaseInput"];
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
    deliveries_api_workspaces__wid__deliveries_get: {
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
                    "application/json": components["schemas"]["DeliverySummary"][];
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
    delivery_api_workspaces__wid__deliveries__did__get: {
        parameters: {
            query?: {
                /** @description summary returns verified structure and source digests; full includes saved HTML/PDF attachments. */
                view?: "full" | "summary";
            };
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
                    "application/json": components["schemas"]["DeliveryResult"] | components["schemas"]["DeliveryReceipt"];
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
    version_api_database_version_get: {
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
                    "application/json": components["schemas"]["DatabaseVersion"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Unprocessable Entity */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
        };
    };
    listing_api_database_backups_get: {
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
                    "application/json": components["schemas"]["SnapshotInfo"][];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Unprocessable Entity */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
        };
    };
    create_api_database_backups_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SnapshotRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SnapshotInfo"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Unprocessable Entity */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
        };
    };
    download_api_database_backups__identifier__file_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                identifier: string;
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
                    "application/vnd.sqlite3": string;
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Unprocessable Entity */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
        };
    };
    request_restore_api_database_restores_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RestoreRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RestoreInfo"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Unprocessable Entity */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
        };
    };
    restore_status_api_database_restores_current_get: {
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
                    "application/json": components["schemas"]["RestoreInfo"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Unprocessable Entity */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
        };
    };
    cancel_restore_api_database_restores_current_delete: {
        parameters: {
            query: {
                request_id: string;
            };
            header?: never;
            path?: never;
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
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Unprocessable Entity */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatabaseError"];
                };
            };
        };
    };
    create_delivery_job_api_workspaces__wid__delivery_jobs_post: {
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
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeliveryJob"];
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
    delivery_job_api_workspaces__wid__delivery_jobs__jid__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                jid: string;
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
                    "application/json": components["schemas"]["DeliveryJob"];
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
    cancel_delivery_job_api_workspaces__wid__delivery_jobs__jid__cancel_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                jid: string;
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
                    "application/json": components["schemas"]["DeliveryJob"];
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
    saved_fem_conclusion_api_workspaces__wid__runs__rid__fem_conclusion_get: {
        parameters: {
            query?: {
                /** @description Preformat the saved projection image on the report worker; only report view should request this. Does not run a solver or alter saved results. */
                prepare_report?: boolean;
            };
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
                    "application/json": components["schemas"]["FemConclusion"];
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
    simulation_problem_contract_api_simulation_problem_contract_get: {
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
                    "application/json": components["schemas"]["ProblemContract"];
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
            query?: {
                plugin_id?: string | null;
                capability?: string | null;
                version?: string | null;
                release_digest?: string | null;
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
            query?: {
                plugin_id?: string | null;
                capability?: string | null;
                version?: string | null;
                release_digest?: string | null;
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
    delivery_pdf_api_workspaces__wid__deliveries__did__pdf_get: {
        parameters: {
            query?: {
                /** @description Saved PDF edition; no unit. */
                audience?: "customer" | "internal";
            };
            header?: never;
            path: {
                wid: string;
                did: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description PDF extracted from the verified immutable delivery; no rendering or solving. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/pdf": string;
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
    query_api_plugin_queries__plugin_id___capability_id__post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                plugin_id: string;
                capability_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CapabilityQuery"];
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
    progress_api_workspaces__wid__studies__sid__runs__rid__progress_get: {
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
    cancel_api_workspaces__wid__studies__sid__runs__rid__cancel_post: {
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
    profile_api_hpc_profile_get: {
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
    save_profile_api_hpc_profile_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    [key: string]: unknown;
                };
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
    heat_capacity_preflight_api_hpc_heat_capacity_preflight_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    [key: string]: unknown;
                };
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
    profile_configuration_api_hpc_profile_configuration_get: {
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
    undo_profile_api_hpc_profile_undo_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    [key: string]: unknown;
                };
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
    check_profile_api_hpc_profile_check_post: {
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
    input_preflight_api_hpc_workspaces__wid__studies__sid__input_preflight_get: {
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
    step_responses_api_hpc_workspaces__wid__studies__sid__step_responses_get: {
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
    step_start_api_hpc_workspaces__wid__studies__sid__step_responses_post: {
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
                "application/json": components["schemas"]["StepRequest"];
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
    step_estimate_api_hpc_workspaces__wid__studies__sid__step_responses_estimate_post: {
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
                "application/json": components["schemas"]["StepRequest"];
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
    step_source_check_api_hpc_workspaces__wid__studies__sid__step_responses_source_check_get: {
        parameters: {
            query: {
                source_run_id: string;
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
    step_detail_api_hpc_step_responses__identifier__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                identifier: string;
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
    step_cancel_api_hpc_step_responses__identifier__cancel_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                identifier: string;
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
    step_resume_api_hpc_step_responses__identifier__resume_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                identifier: string;
            };
            cookie?: never;
        };
        requestBody?: never;
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
    jobs_api_hpc_jobs_get: {
        parameters: {
            query?: {
                offset?: number;
                limit?: number;
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
    job_detail_api_hpc_jobs__identifier__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                identifier: string;
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
    cancel_api_hpc_jobs__identifier__cancel_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                identifier: string;
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
    refresh_api_hpc_jobs__identifier__refresh_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                identifier: string;
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
    convergence_api_hpc_convergence_get: {
        parameters: {
            query?: {
                workspace?: string | null;
                study?: string | null;
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
    estimate_api_hpc_workspaces__wid__studies__sid__estimate_get: {
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
    availability_api_hpc_workspaces__wid__studies__sid__availability_get: {
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
    start_api_hpc_workspaces__wid__studies__sid__convergence_post: {
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
                "application/json": components["schemas"]["RefineRequest"];
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
    detail_api_hpc_convergence__identifier__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                identifier: string;
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
    cancel_convergence_api_hpc_convergence__identifier__cancel_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                identifier: string;
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
    resume_api_hpc_convergence__identifier__resume_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                identifier: string;
            };
            cookie?: never;
        };
        requestBody?: never;
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
    report_chapter_api_hpc_workspaces__wid__chapters__rid__get: {
        parameters: {
            query: {
                iec_run_id: string;
                convergence_id?: string | null;
            };
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
    image_api_hpc_workspaces__wid__fields__rid__png_get: {
        parameters: {
            query?: {
                case_id?: string | null;
            };
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
    field_view_api_hpc_workspaces__wid__fields__rid__view_get: {
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
    field_archive_api_hpc_workspaces__wid__fields__rid__full_get: {
        parameters: {
            query?: {
                case_id?: string | null;
            };
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
    field_sample_api_hpc_workspaces__wid__fields__rid__sample_post: {
        parameters: {
            query?: {
                case_id?: string | null;
            };
            header?: never;
            path: {
                wid: string;
                rid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": [
                    number,
                    number
                ][];
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
                "application/json": components["schemas"]["ExtractionScope-Input"];
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
    batch_propose_api_documents__did__batches_post: {
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
                "application/json": components["schemas"]["BatchProposalRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BatchProposalResponse"];
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
    batch_api_documents__did__batches__bid__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                did: string;
                bid: string;
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
                    "application/json": components["schemas"]["BatchProposalResponse"];
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
    batch_approve_api_documents__did__batches__bid__approval_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                did: string;
                bid: string;
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
                    "application/json": components["schemas"]["BatchProposalResponse"];
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
    declare_scope_api_types__wid__release_scope_post: {
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
                "application/json": components["schemas"]["ReleaseScope"];
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
    short_circuit_basis_api_types__wid__short_circuit_basis_post: {
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
                "application/json": components["schemas"]["AnalysisBasis"];
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
    creation_options_api_types_creation_options_get: {
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
    creation_proposal_api_types_creation_proposals_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewTypeProposal"];
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
    create_api_types_post: {
        parameters: {
            query?: never;
            header?: {
                "x-cablesim-actor"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NewType"];
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
    save_document_api_types__wid__document_put: {
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
                "application/json": components["schemas"]["SaveTypeDocument"];
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
    resources_api_types__wid__resources_get: {
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
    type_workspace_api_types__wid__workspace_get: {
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
    bind_resource_api_types__wid__resources_bind_post: {
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
                "application/json": components["schemas"]["BindResource"];
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
    preview_material_bindings_api_types__wid__resources_material_preview_post: {
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
                "application/json": components["schemas"]["PreviewMaterialBindings"];
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
    confirm_material_bindings_api_types__wid__resources_material_confirm_post: {
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
                "application/json": components["schemas"]["ConfirmMaterialBindings"];
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
    migrate_resources_api_types__wid__resources_migrate_post: {
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
                "application/json": components["schemas"]["MigrateResources"];
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
    material_comparison_api_types__wid__material_comparison_get: {
        parameters: {
            query?: {
                revision?: number | null;
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
    adopt_material_value_api_types__wid__material_comparison_adopt_post: {
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
                "application/json": components["schemas"]["AdoptMaterialValue"];
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
            query?: {
                audience?: "customer" | "internal";
                view?: "full" | "detail";
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
    generate_specification_api_types__wid__specification_generate_post: {
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
                "application/json": components["schemas"]["GenerateSpecification"];
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
    specification_file_api_types__wid__specification_file_get: {
        parameters: {
            query: {
                expected_revision: number;
                specification_digest: string;
                audience?: "customer" | "internal";
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
    save_measurements_api_types__wid__measurements_post: {
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
                "application/json": components["schemas"]["SaveMeasurements"];
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
    standards_summary_api_types__wid__standards_summary_get: {
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
    display_runs_api_types__wid__display_runs_get: {
        parameters: {
            query?: {
                after?: number;
                limit?: number;
                recent?: boolean;
                module?: ("structure" | "requirements" | "standard-check" | "electrical" | "short-circuit" | "rating-table" | "comparison" | "specification") | null;
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
    measurement_report_api_types__wid__measurements_reports__report_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wid: string;
                report_id: string;
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
    vocabulary_api_type_library_vocabulary_get: {
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
    mappings_api_type_library_mappings_get: {
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
    mapping_api_type_library_mappings_post: {
        parameters: {
            query?: never;
            header?: {
                "x-cablesim-actor"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Mapping"];
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
    upload_api_type_library_imports_upload_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_api_type_library_imports_upload_post"];
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
    preview_api_type_library_imports_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Preview"];
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
    commit_api_type_library_imports_commit_post: {
        parameters: {
            query?: never;
            header?: {
                "x-cablesim-actor"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Commit"];
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
    series_api_type_library_series_get: {
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
    series_detail_api_type_library_series__identifier__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                identifier: string;
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
    spec_api_type_library_specs__identifier__get: {
        parameters: {
            query?: {
                version?: number | null;
            };
            header?: never;
            path: {
                identifier: string;
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
    revise_api_type_library_specs__identifier__revisions_post: {
        parameters: {
            query?: never;
            header?: {
                "x-cablesim-actor"?: string | null;
            };
            path: {
                identifier: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Revise"];
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
    batch_api_type_library_series__identifier__batch_post: {
        parameters: {
            query?: never;
            header?: {
                "x-cablesim-actor"?: string | null;
            };
            path: {
                identifier: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Batch"];
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
    samples_api_type_library_samples_get: {
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
    sample_xlsx_api_type_library_samples__name__xlsx_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                name: string;
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
    sample_csv_api_type_library_samples__name__csv_get: {
        parameters: {
            query?: {
                table?: string | null;
            };
            header?: never;
            path: {
                name: string;
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
    comparison_api_type_library_catalogue_comparison__name__post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                name: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["CatalogueComparison"] | null;
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
    export_route_api_type_library_exchange_export_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Selection"];
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
    preview_route_api_type_library_exchange_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_preview_route_api_type_library_exchange_preview_post"];
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
    import_route_api_type_library_exchange_import_post: {
        parameters: {
            query?: never;
            header?: {
                "x-cablesim-actor"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_import_route_api_type_library_exchange_import_post"];
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
    export_api_library_exchange_export_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExportSelection"];
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
    preview_api_library_exchange_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_preview_api_library_exchange_preview_post"];
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
    import_data_api_library_exchange_import_post: {
        parameters: {
            query?: never;
            header?: {
                "x-cablesim-actor"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_import_data_api_library_exchange_import_post"];
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
    catalogue_api_library_resources_catalogue_get: {
        parameters: {
            query?: {
                category?: "materials" | "environment" | "manufacturing";
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
    table_api_library_resources_table_get: {
        parameters: {
            query: {
                category: "materials" | "environment" | "manufacturing";
                table_id: string;
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
    select_api_library_resources_select_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["backend__kernel__resource_data__Selection"];
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
    draft_preview_api_library_resources_materials_draft_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MaterialReferenceDraft"];
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
    draft_api_library_resources_materials_draft_post: {
        parameters: {
            query?: never;
            header?: {
                "x-cablesim-actor"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateMaterialReferenceDraft"];
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
    preview_api_library_resources_materials_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MaterialReferencePreview"];
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
    adopt_api_library_resources_materials_adopt_post: {
        parameters: {
            query?: never;
            header?: {
                "x-cablesim-actor"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdoptMaterialReference"];
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
    preview_draft_api_library_resources_environment_draft_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EnvironmentDraftPreview"];
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
    create_asset_api_library_resources_environment_draft_post: {
        parameters: {
            query?: never;
            header?: {
                "x-cablesim-actor"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EnvironmentDraft"];
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
    preview_asset_api_library_resources_environment_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EnvironmentPreview"];
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
    evidence_api_library_resources_applications__resource_id__evidence_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                resource_id: string;
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
    study_capture_preview_api_library_resources_study_templates_capture_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CaptureStudy"];
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
    study_capture_api_library_resources_study_templates_capture_post: {
        parameters: {
            query?: never;
            header?: {
                "x-cablesim-actor"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateStudyTemplate"];
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
    study_preview_api_library_resources_study_templates_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreviewStudyTemplate"];
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
    study_adopt_api_library_resources_study_templates_adopt_post: {
        parameters: {
            query?: never;
            header?: {
                "x-cablesim-actor"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdoptStudyTemplate"];
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
    preview_capture_api_library_resources_components_capture_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CaptureComponent"];
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
    capture_api_library_resources_components_capture_post: {
        parameters: {
            query?: never;
            header?: {
                "x-cablesim-actor"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateComponent"];
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
    preview_api_library_resources_components_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreviewComponent"];
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
    adopt_api_library_resources_components_adopt_post: {
        parameters: {
            query?: never;
            header?: {
                "x-cablesim-actor"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdoptComponent"];
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
    resolve_api_design_type_workspaces__wid__requirements_basis_post: {
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
                "application/json": components["schemas"]["ResolveBasis"];
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
            query?: {
                view?: "full" | "rows";
            };
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
    preview_api_formal_deliveries_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreviewRequest"];
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
    export_api_formal_deliveries_export_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExportRequest"];
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
    batch_preview_api_formal_deliveries_batch_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BatchPreviewRequest"];
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
    batch_export_api_formal_deliveries_batch_export_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BatchExportRequest"];
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
    capabilities_api_agent_capabilities_get: {
        parameters: {
            query?: {
                module?: string | null;
                q?: string | null;
                offset?: number;
                limit?: number;
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
    status_api_agent_status_get: {
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
                    "application/json": components["schemas"]["AgentStatus"];
                };
            };
        };
    };
    settings_api_agent_settings_get: {
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
    save_settings_api_agent_settings_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModelSettingsUpdate"];
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
    reset_settings_api_agent_settings_delete: {
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
    test_settings_api_agent_settings_test_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModelSettingsTest"];
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
    memory_settings_api_agent_memory_settings_get: {
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
    save_memory_settings_api_agent_memory_settings_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemorySettings"];
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
    memories_api_agent_memories_get: {
        parameters: {
            query: {
                workspace_id: string;
                study_id?: string | null;
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
    correct_memory_api_agent_memories__id__put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MemoryEdit"];
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
    delete_memory_api_agent_memories__id__delete: {
        parameters: {
            query: {
                expected_revision: number;
            };
            header?: never;
            path: {
                id: string;
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
    session_memory_api_agent_sessions__id__memory_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
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
    remember_session_api_agent_sessions__id__memory_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
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
    tools_api_agent_tools_get: {
        parameters: {
            query?: {
                session_id?: string | null;
                workspace_id?: string | null;
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
                    "application/json": components["schemas"]["ToolInfo"][];
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
    recipe_catalog_api_agent_recipes_get: {
        parameters: {
            query?: {
                session_id?: string | null;
                workspace_id?: string | null;
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
                    "application/json": components["schemas"]["RecipeInfo"][];
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
    sessions_api_agent_sessions_get: {
        parameters: {
            query?: {
                workspace_id?: string | null;
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
                    "application/json": components["schemas"]["SessionSummary"][];
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
    create_api_agent_sessions_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateSession"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionId"];
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
    session_api_agent_sessions__id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
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
                    "application/json": components["schemas"]["SessionRecord"];
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
    message_api_agent_sessions__id__messages_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Message"];
            };
        };
        responses: {
            /** @description SSE events, each event/data JSON pair separated by a blank line. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
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
    approve_api_agent_proposals__id__approve_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
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
                    "application/json": components["schemas"]["ProposalDecision"];
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
    reject_api_agent_proposals__id__reject_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
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
                    "application/json": components["schemas"]["ProposalDecision"];
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
    reconcile_api_agent_sessions__id__reconcile_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
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
    contract_api_agent_contract_get: {
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
    objects_api_index_objects_get: {
        parameters: {
            query?: {
                kind?: ("project" | "study" | "type" | "cable_version" | "asset" | "run" | "job" | "delivery" | "plugin" | "validation" | "document" | "proposal" | "agent_task" | "input_snapshot") | null;
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
                    "application/json": components["schemas"]["ObjectList"];
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
    relations_api_index_objects__kind___id__relations_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                kind: "project" | "study" | "type" | "cable_version" | "asset" | "run" | "job" | "delivery" | "plugin" | "validation" | "document" | "proposal" | "agent_task" | "input_snapshot";
                id: string;
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
                    "application/json": components["schemas"]["Relations"];
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
    inbox_api_index_inbox_get: {
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
                    "application/json": components["schemas"]["Inbox"];
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

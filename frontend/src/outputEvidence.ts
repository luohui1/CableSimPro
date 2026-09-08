import type {Result, Scenario, Sweep} from './types';
import {canonical} from './utils';

/** The workspace and revision that actually returned this output.
 * null revision is an explicit, read-only history selection, not a wildcard.
 */
export interface OutputSource {workspaceId:string; revision:number|null; runId:string; inputHash:string}
interface EvidenceWorkspace {
 id:string; revision:number; scenario:Scenario; design_basis?:Record<string,unknown>;
 runs:{id:string; revision:number; input_hash:string}[];
}
interface EvidenceOutput {run_id?:string; result:Result|null; sweep:Sweep|null}
interface CurrentOutput {outputCurrent:boolean; current:Result|null; currentSweep:Sweep|null}
const unavailable=():CurrentOutput=>({outputCurrent:false,current:null,currentSweep:null});

/** Capture the run binding with the response, not from a later render. */
export function captureOutputSource(workspace:EvidenceWorkspace,output:EvidenceOutput|null,revision:number|null):OutputSource|null {
 const run=workspace.runs.find(record=>record.id===output?.run_id);
 return run?{workspaceId:workspace.id,revision,runId:run.id,inputHash:run.input_hash}:null;
}

/** Display/export eligibility, not a new solver or engineering certification.
 * Matching numeric inputs alone cannot make a historical run current again.
 */
export function selectCurrentOutput(
 workspace:EvidenceWorkspace|null, output:EvidenceOutput|null,
 source:OutputSource|null, hasDrafts:boolean,
):CurrentOutput {
 if(!workspace||!output||!source||hasDrafts||!workspace.id||
    source.workspaceId!==workspace.id||!Number.isSafeInteger(workspace.revision)||workspace.revision<1||
    source.revision!==workspace.revision||source.runId!==output.run_id||!output.run_id||!Array.isArray(workspace.runs))return unavailable();
 const run=workspace.runs.find(record=>record.id===output.run_id);
 if(!run||run.revision!==workspace.revision||source.inputHash!==run.input_hash||!/^[a-f0-9]{64}$/i.test(run.input_hash))return unavailable();
 // The existing workspace hash and solver hash serialize Python int/float
 // values differently (240 vs 240.0). Do not equate these two hash domains.
 // Bind the saved run hash above and compare the parsed input snapshot below.
 const result=output.result;
 if(result&&(!result.model_version?.trim()||!/^[a-f0-9]{64}$/i.test(result.input_sha256)||
    typeof result.computed_at!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(result.computed_at)||!Number.isFinite(Date.parse(result.computed_at))||
    !Number.isFinite(result.summary?.ampacity_a)||result.summary.ampacity_a<=0||
    canonical(result.input)!==canonical(workspace.scenario)||
    canonical(result.design_basis??null)!==canonical(workspace.design_basis??null)))return unavailable();
 const sweep=output.sweep;
 if(sweep&&(!sweep.parameter||!Array.isArray(sweep.points)||!sweep.points.length||
    sweep.points.some(point=>!point||!Number.isFinite(point.value)||
      (point.ampacity_a!==null&&(!Number.isFinite(point.ampacity_a)||point.ampacity_a<=0))||
      (point.ampacity_a===null&&(typeof point.error!=='string'||!point.error.trim())))))return unavailable();
 return {outputCurrent:true,current:result??null,currentSweep:sweep??null};
}

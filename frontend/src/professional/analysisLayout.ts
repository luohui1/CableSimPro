/** Local presentation preferences only. This state never enters an engineering snapshot. */
export type AnalysisMode='summary'|'split'|'full';
export function resolveAnalysisMode(requested:AnalysisMode,height:number,width:number):AnalysisMode {
 // At laptop heights a second pane would make both the model and chart unusable.
 return requested==='split'&&(height<900||width<1100)?'full':requested;
}

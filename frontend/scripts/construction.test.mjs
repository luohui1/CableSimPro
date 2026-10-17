import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
async function load(relative) {
  const source=await readFile(new URL(relative,import.meta.url),'utf8');
  const result=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},reportDiagnostics:true});
  assert.equal(result.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
  return import('data:text/javascript;base64,'+Buffer.from(result.outputText).toString('base64'));
}
const geometry=await load('../src/features/scene/surface-model.ts');
const build=await load('../src/features/scene/construction.ts');
const motion=await load('../src/features/scene/assembly.ts');
const physics=await load('../src/features/thermal-workbench/physics-audit.ts');
function scene() {
  return {identity:'a'.repeat(64),bounds:[-.02,0,-.82,.02,.6,-.78],objects:[{id:'c1',label:'Cable',kind:'cable',bounds:[-.02,0,-.82,.02,.6,-.78]}],geometries:{cable:geometry.annulus(0,.02,.6)},draws:[{geometry:'cable',objectId:'c1',category:'conductor',transforms:[[1,0,0,0,0,1,0,0,0,0,1,-.8]]}]};
}
function assertBounds(model) {
  for(const draw of model.draws){const object=model.objects.find(o=>o.id===draw.objectId),mesh=model.geometries[draw.geometry];
    for(const transform of draw.transforms)for(let i=0;i<mesh.positions.length;i+=3){const p=geometry.point(transform,Array.from(mesh.positions).slice(i,i+3));assert(p.every((v,axis)=>v>=object.bounds[axis]-1e-8&&v<=object.bounds[axis+3]+1e-8),object.label);}
  }
}
for(const {id} of build.constructionKinds)test(`parametric ${id}: valid hollow/windowed geometry and correct metre bounds`,()=>{
  const original=scene(),result=build.constructScene(original,build.suggestedConstruction(original,id));
  geometry.validateSurface(result.model);assertBounds(result.model);assert(result.addedIds.length>0);assert(result.addedIds.every(id=>id.startsWith('presentation:')));
});
test('construction proposals preserve source object identity and all engineering inputs',()=>{
  const original=scene(),before=structuredClone(original),result=build.constructScene(original,build.suggestedConstruction(original,'trench'));
  assert.deepEqual(original,before);assert.equal(result.sourceIdentity,original.identity);assert.notEqual(result.model.identity,original.identity);assert.equal(result.model.objects[0],original.objects[0]);assert.equal(result.model.draws[0],original.draws[0]);
});
test('repeated crossbars and lids share prototype meshes through instances',()=>{
  const s=scene(),r=build.constructScene(s,build.suggestedConstruction(s,'trench'));assert(r.model.draws.filter(d=>d.transforms.length>1).length>=3);
});
test('invalid dimensions, excessive wall thickness and empty cable scenes are rejected',()=>{
  const s=scene(),spec=build.suggestedConstruction(s,'trench');
  for(const value of [0,-1,NaN,Infinity])assert.throws(()=>build.constructScene(s,{...spec,width:value}));
  assert.throws(()=>build.constructScene(s,{...spec,wall:spec.width}));assert.throws(()=>build.constructScene({...s,objects:[]},spec));
});
test('net dimensions cannot silently move or shrink cables to make a scenario fit',()=>{
  const s=scene();assert.throws(()=>build.constructScene(s,{...build.suggestedConstruction(s,'trench'),width:.01}));
});
test('too many mechanical supports are refused before mesh allocation',()=>{
  const s=scene();s.objects[0].bounds[4]=30;s.bounds[4]=30;assert.throws(()=>build.constructScene(s,{...build.suggestedConstruction(s,'tray'),pitch:.03}));
});
test('circular tunnel width and height cannot silently disagree',()=>{
  const s=scene(),spec=build.suggestedConstruction(s,'tunnel');assert.equal(spec.width,spec.height);assert.throws(()=>build.constructScene(s,{...spec,height:spec.height+.1}));
});
test('duct spacing is checked without repositioning engineering cables',()=>{
  const s=scene();s.objects.push({...s.objects[0],id:'c2'});assert.throws(()=>build.suggestedConstruction(s,'duct-bank'));assert.throws(()=>build.constructScene(s,{kind:'duct-bank',width:1,height:1,wall:.02,clearance:.02,pitch:.25}));
});
test('proposed pipe clearance fits separated cable groups',()=>{
  const s=scene(),b=s.objects[0].bounds;s.objects.push({...s.objects[0],id:'c2',bounds:[b[0]+.12,b[1],b[2],b[3]+.12,b[4],b[5]]});
  const spec=build.suggestedConstruction(s,'duct-bank');const r=build.constructScene(s,spec);assert.equal(r.addedIds.length,3);geometry.validateSurface(r.model);
});
test('pipe shells retain their bore rather than returning a solid cylinder',()=>{
  const g=build.sectorMesh(.04,.05,1);for(let i=0;i<g.positions.length;i+=3){const r=Math.hypot(g.positions[i],g.positions[i+2]);assert(r>=.04-1e-10&&r<=.05+1e-10);}
});
test('flat box faces have independent normals and exactly 12 triangles',()=>{
  const g=build.boxMesh(.4,1,.3);assert.equal(g.positions.length/3,24);assert.equal(g.triangles.length/3,12);
});
test('source and presentation object ID collision is refused',()=>{
  const s=scene();s.objects.push({id:`presentation:${s.identity}:tray:0`,label:'collision',kind:'soil',bounds:s.bounds});assert.throws(()=>build.constructScene(s,build.suggestedConstruction(s,'tray')));
});
test('assembly progress is bounded, reversible and independent of thermal seconds',()=>{
  assert.equal(motion.assemblyProgress(0,1,0),0);assert.equal(motion.assemblyProgress(0,1,800),.5);assert.equal(motion.assemblyProgress(0,1,2000),1);assert.equal(motion.assemblyProgress(1,0,1600),0);assert.equal(motion.assemblyProgress(0,1,-1),0);assert.throws(()=>motion.assemblyProgress(0,1,NaN));
});
test('scientific fields can never inherit a presentation displacement',()=>{
  const s=scene();assert.deepEqual(motion.assemblyOffset(s,{...s.draws[0],category:'temperature-field',presentationOffset:[3,4,5]}),[0,0,0]);
});
test('assembly offsets do not mutate the source rigid matrices',()=>{
  const s=scene(),before=structuredClone(s);assert.deepEqual(motion.assemblyOffset(s,{...s.draws[0],category:'polymer'}),[0,.39,0]);assert.deepEqual(s,before);
});
test('nonfinite or oversized display transforms fail before GPU allocation',()=>{
  for(const offset of [[NaN,0,0],[101,0,0]]){const s=scene();s.draws[0].presentationOffset=offset;assert.throws(()=>geometry.validateSurface(s));}
});
function physicalNetwork(){
  const mutual=[[.7,.2,.1],[.2,.7,.2],[.1,.2,.7]],losses=[24,26,25],ambient=20;
  const profiles=['A','B','C'].map((phase,i)=>({phase,temperatures:[100,ambient+mutual[i].reduce((s,v,j)=>s+v*losses[j],0)]}));
  return {network:{mutual,ambient},state:{current:300,losses,profiles}};
}
test('same-case saved G, losses and surface temperatures pass the arithmetic audit',()=>{
  const {network,state}=physicalNetwork(),r=physics.auditNetwork(network,state);assert.equal(r.status,'consistent');assert(r.maximumResidual<1e-10);
});
test('changing a saved surface value is reported, not repaired or approved',()=>{
  const {network,state}=physicalNetwork();state.profiles[1].temperatures[1]+=3;const before=structuredClone(state),r=physics.auditNetwork(network,state);assert.equal(r.status,'inconsistent');assert.equal(r.rows[1].residual,3);assert.deepEqual(state,before);
});
test('phase profile order cannot change physical A/B/C identity',()=>{
  const {network,state}=physicalNetwork();state.profiles.reverse();assert.equal(physics.auditNetwork(network,state).status,'consistent');
});
test('nonreciprocal or nonpassive soil influence matrices are reported',()=>{
  const {network,state}=physicalNetwork();network.mutual[0][1]=.3;assert.equal(physics.auditNetwork(network,state).reciprocal,false);
  network.mutual=[[.1,.2,.2],[.2,.1,.2],[.2,.2,.1]];assert.equal(physics.auditNetwork(network,state).passive,false);
});
test('a missing operating state stays missing, not silently replaced by rated data',()=>{
  const {network}=physicalNetwork();const r=physics.auditNetwork(network,null);assert.equal(r.status,'missing');assert.equal(r.maximumResidual,null);
});

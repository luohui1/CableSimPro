import test from "node:test";
import assert from "node:assert/strict";
import fs from 'node:fs';
import { declaredParameterDefaults, parameterErrors, parameterReferences, setParameterValue } from '../src/lib/study-parameter-form.ts';
import { missingInputDestination } from "../src/lib/missing-input.ts";
import { countInputChanges } from "../src/lib/input-changes.ts";
import {
  domainDraftReducer,
  emptyDomainHistory,
} from "../src/lib/domain-draft-history.ts";

test('正式仿真契约只带入声明值，可空对象不触发不存在的子项要求',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../../plugins/cablesim.simulation/plugin.json',import.meta.url),'utf8'));
  const schema=manifest.capabilities.find(cap=>cap.id==='iec-fem-comparison').parameter_schema;
  const defaults=declaredParameterDefaults(schema);
  assert.deepEqual(defaults.mesh_scales,[1.5,1,0.75]);
  assert.equal(defaults.feedback,null);
  assert.equal(defaults.frozen_coefficients_acknowledged,false);
  for(const key of ['section_id','load_id','bounds_m','source'])assert.equal(key in defaults,false);
  const errors=parameterErrors(schema,defaults);
  assert.ok(errors['/section_id']);assert.ok(errors['/source']);
  assert.equal(Object.keys(errors).some(path=>path.startsWith('/feedback/')),false);
  assert.equal(Object.keys(errors).some(path=>path.startsWith('/mesh_scales/')),false);
});

test('参数编辑保留转义对象身份与坐标顺序，不把空槽位移成相邻坐标',()=>{
  const original={bounds_m:[-8,-8,8,0],per_cable:{'cable/a':{source:'已保存来源'}}};
  const changed=setParameterValue(original,'/per_cable/cable~1a/source','工程师核对');
  assert.equal(changed.per_cable['cable/a'].source,'工程师核对');
  assert.equal(original.per_cable['cable/a'].source,'已保存来源');
  assert.deepEqual(setParameterValue(original,'/bounds_m/1',undefined).bounds_m,[-8,null,8,0]);
  const schema={type:'object',required:['rows'],properties:{rows:{type:'object',additionalProperties:{type:'object',required:['value'],properties:{value:{type:'number',minimum:1}}}}}};
  assert.deepEqual(Object.keys(parameterErrors(schema,{rows:{'a/b':{value:0}}})),['/rows/a~1b/value']);
});

test('创建表单只引用当前真实工程里的截面、负荷和对象',()=>{
  const refs=parameterReferences({sections:[{id:'s',enclosures:[{id:'duct',type:'duct'},{id:'tray',type:'tray'}]}],load_cases:[{id:'load'}],circuits:[{id:'circuit',cables:[{id:'wire'}]}]},id=>'名称 '+id);
  assert.deepEqual(refs.section_id,[{value:'s',label:'名称 s'}]);
  assert.deepEqual(refs.load_id,refs.load_case_id);
  assert.deepEqual(refs.cable,[{value:'wire',label:'名称 wire'}]);
  assert.deepEqual(refs.duct,[{value:'duct',label:'名称 duct'}]);
  assert.deepEqual(refs.material,[]);
});
test('未保存计数合并数值与来源，按稳定对象身份处理新增和删除', () => {
  const before = {layers: [{id: 'a', thickness: 1}, {id: 'b', thickness: 2}], provenance: {}};
  const changed = {layers: [{id: 'a', thickness: 3}, {id: 'b', thickness: 4}], provenance: {'/layers': {kind: 'user'}}};
  assert.equal(countInputChanges(before, changed, ['/layers/a/thickness']), 2);
  assert.equal(countInputChanges(before, {...before, layers: [before.layers[1]]}), 1);
  assert.equal(countInputChanges(before, {...before, layers: [...before.layers, {id: 'c', thickness: 3, material: 'm'}]}), 1);
  assert.equal(countInputChanges(before, {...before, layers: [...before.layers].reverse()}), 1);
  assert.equal(countInputChanges(before, before), 0);
});
test('独立来源修订和未提交的非法数值也保留在修改计数中', () => {
  const before = {x: 1, provenance: {'/x': {kind: 'user', reference: '旧依据'}}};
  const changed = {x: 1, provenance: {'/x': {kind: 'user', reference: '新依据'}}};
  assert.equal(countInputChanges(before, changed), 1);
  assert.equal(countInputChanges(before, changed, ['/y']), 2);
  assert.equal(countInputChanges(before, {...changed, x: 2}, ['/x']), 1);
});
test("预检区分领域输入与方法温度参数，不按temperature误跳工况", () => {
  assert.equal(
    missingInputDestination(
      "INPUT_INVALID: Input should be a valid number",
      "ampacity",
      "conditions",
    ).module,
    "conditions",
  );
  assert.deepEqual(
    missingInputDestination(
      "/sections/section~1s/placements/cable~1a/z",
      "ampacity",
    ),
    { module: "section", tab: "coordinates", label: "敷设坐标与尺寸" },
  );
  assert.equal(
    missingInputDestination(
      "/parameters/target_conductor_temperature_k",
      "transient",
    ).module,
    "transient",
  );
  assert.equal(
    missingInputDestination("soil thermal resistivity missing", "ampacity")
      .module,
    "conditions",
  );
});
test("撤销画布手势保留无关输入文本，重做恢复同一基准", () => {
  const base = { sections: [{ id: "s", x: 0 }] };
  const draft = {
    base,
    document: structuredClone(base),
    revision: 7,
    scope: "section",
    fields: {
      "/materials/m/rho": {
        value: "invalid",
        spec: { path: "/materials/m/rho" },
      },
    },
  };
  const start = domainDraftReducer(emptyDomainHistory, {
    type: "set",
    update: draft,
  });
  const next = domainDraftReducer(start, {
    type: "set",
    record: true,
    consumed: ["/sections/s"],
    update: { ...draft, document: { sections: [{ id: "s", x: 1 }] } },
  });
  const undone = domainDraftReducer(next, { type: "undo" });
  assert.equal(undone.present.fields["/materials/m/rho"].value, "invalid");
  assert.deepEqual(undone.present.document, base);
  assert.equal(
    domainDraftReducer(undone, { type: "redo" }).present.document.sections[0].x,
    1,
  );
  assert.equal(base.sections[0].x, 0);
  assert.equal(
    domainDraftReducer(undone, { type: "redo" }).present.revision,
    7,
  );
});
test("确认数值后撤销不复活待提交文本，保存或切研究清空历史", () => {
  const base = { x: 0 };
  const draft = {
    base,
    document: base,
    revision: 1,
    scope: "section",
    fields: { "/x": { value: "1", spec: { path: "/x" } } },
  };
  const state = domainDraftReducer(
    { present: draft, past: [], future: [] },
    {
      type: "set",
      record: true,
      consumed: ["/x"],
      update: { ...draft, document: { x: 1 } },
    },
  );
  assert.equal(domainDraftReducer(state, { type: "undo" }).present, null);
  assert.deepEqual(
    domainDraftReducer(state, { type: "set", update: null }),
    emptyDomainHistory,
  );
});

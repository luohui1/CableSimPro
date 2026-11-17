import test from "node:test";
import assert from "node:assert/strict";
import fs from 'node:fs';
import { clearParameterDrafts, declaredParameterDefaults, parameterErrors, parameterReferences, reindexParameterDrafts, setParameterValue } from '../src/lib/study-parameter-form.ts';
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

test('真实可空损耗温度表重置后不被隐藏数字或JSON草稿复活', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../../plugins/cablesim.simulation/plugin.json', import.meta.url), 'utf8'));
  const schema = manifest.capabilities.find(cap => cap.id === 'sheath-losses').parameter_schema;
  const module = 'sheath-losses', path = '/temperature_table';
  const entries = [
    { module, path, kind: 'json', text: '{' },
    { module, path: path + '/maximum_validation_absolute_error', kind: 'number', text: 'invalid' },
    { module, path: path + '/resistivity_laws/region~1a/reference_temperature_k', kind: 'number', text: '321.1234567890123' },
    { module, path: '/temperature_table_notes/value', kind: 'number', text: '7' },
    { module: 'other-method', path: path + '/maximum_validation_absolute_error', kind: 'number', text: 'invalid elsewhere' },
  ];
  const fields = Object.fromEntries(entries.map(field => [field.module + field.path, field]));
  const cleaned = clearParameterDrafts(fields, module, path);
  assert.deepEqual(Object.values(cleaned), entries.slice(3));
  for (const replacement of [null, undefined]) {
    const values = setParameterValue({ temperature_table: { maximum_validation_absolute_error: 0.01 } }, path, replacement);
    assert.equal(values.temperature_table, replacement);
    assert.equal(Object.values(cleaned).some(field => field.module === module && (field.path === path || field.path.startsWith(path + '/'))), false);
  }
  assert.deepEqual(parameterErrors(schema.properties.temperature_table, null, schema, path), {});
  assert.equal(fields[module + path].text, '{');
});

test('清理按精确表单命名空间和转义指针边界保留兄弟与其他对照', () => {
  const namespace = 'method-compare-crosscheck-0';
  const make = (path, crosscheck = 0) => ({ module: 'method-compare', crosscheck, path, kind: 'number', text: 'invalid' });
  const fields = {
    [namespace + '/laws/region~1a/source']: make('/laws/region~1a/source'),
    [namespace + '/laws/region~1ab/source']: make('/laws/region~1ab/source'),
    [namespace + '/laws/region/a/source']: make('/laws/region/a/source'),
    [namespace + '/laws/region~01a/source']: make('/laws/region~01a/source'),
    ['method-compare-crosscheck-1/laws/region~1a/source']: make('/laws/region~1a/source', 1),
    [namespace + '/rows/1/value']: make('/rows/1/value'),
    [namespace + '/rows/10/value']: make('/rows/10/value'),
  };
  const cleaned = clearParameterDrafts(clearParameterDrafts(fields, namespace, '/laws/region~1a'), namespace, '/rows/1');
  assert.equal(Object.keys(cleaned).length, 5);
  for (const [key, field] of Object.entries(fields)) if (key !== namespace + '/laws/region~1a/source' && key !== namespace + '/rows/1/value') assert.equal(cleaned[key], field);
});

test('删数组前行移走幸存草稿的路径与数值元数据，不串行或吞掉非法文本', () => {
  const namespace = 'method-compare-crosscheck-0', path = '/temperature_table/axes';
  const make = (index, text) => ({ module: 'method-compare', crosscheck: 0, path: `${path}/${index}/regions`, kind: 'json', text });
  const removed = make(0, '[invalid removed]'), retained = make(1, '["region/a"'), last = make(2, '["region/b"]');
  const quantity = { module: 'method-compare', crosscheck: 0, path: `${path}/1/nested~1value`, kind: 'number', text: '1.2345678901234567', spec: { path: `${path}/1/nested~1value`, scale: 1000, offset: 0, required: true } };
  const other = { ...retained, crosscheck: 1 }, sibling = { ...retained, path: '/temperature_table/axes_extra/1/regions' };
  const fields = {
    [namespace + removed.path]: removed, [namespace + retained.path]: retained, [namespace + last.path]: last,
    [namespace + quantity.path]: quantity, ['method-compare-crosscheck-1' + other.path]: other, [namespace + sibling.path]: sibling,
  };
  const changed = reindexParameterDrafts(fields, namespace, path, [1, 2]);
  assert.equal(changed[namespace + path + '/0/regions'].text, retained.text);
  assert.equal(changed[namespace + path + '/1/regions'].text, last.text);
  assert.equal(changed[namespace + path + '/2/regions'], undefined);
  assert.equal(changed[namespace + path + '/0/nested~1value'].text, quantity.text);
  assert.deepEqual(changed[namespace + path + '/0/nested~1value'].spec, { ...quantity.spec, path: path + '/0/nested~1value' });
  assert.equal(changed['method-compare-crosscheck-1' + other.path], other);
  assert.equal(changed[namespace + sibling.path], sibling);
  assert.equal(changed[namespace + path + '/0/regions'].crosscheck, 0);
  assert.equal(fields[namespace + retained.path], retained);
  const appended = reindexParameterDrafts(changed, namespace, path, [0, 1, -1]);
  assert.deepEqual(appended, changed);
  const empty = reindexParameterDrafts(changed, namespace, path, []);
  assert.deepEqual(empty, { ['method-compare-crosscheck-1' + other.path]: other, [namespace + sibling.path]: sibling });
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

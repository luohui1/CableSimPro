import test from "node:test";
import assert from "node:assert/strict";
import { missingInputDestination } from "../src/lib/missing-input.ts";
import { countInputChanges } from "../src/lib/input-changes.ts";
import {
  domainDraftReducer,
  emptyDomainHistory,
} from "../src/lib/domain-draft-history.ts";
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

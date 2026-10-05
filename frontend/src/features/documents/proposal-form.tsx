import { useState } from "react";
import type { Extraction, ProposalInput } from "@/api/documents";
import { optionalRecord, text } from "@/api/client";
import { displayName } from "@/lib/display-names";
import { Button } from "@/components/ui/button";
type Binding = { path: string; label: string };
export function bindingOptions(
  payload: Record<string, unknown>,
  field: string,
): Binding[] {
  const cable = optionalRecord(payload.cable_type),
    options: Binding[] = [];
  const roles: Record<string, string> = {
    insulation_thickness: "insulation",
    metallic_sheath_thickness: "metallic_sheath",
    conductor_screen_thickness: "conductor_screen",
    insulation_screen_thickness: "insulation_screen",
    inner_sheath_thickness: "bedding",
    oversheath_thickness: "oversheath",
  };
  function layers(value: unknown, prefix: string, label: string) {
    if (Array.isArray(value))
      value.forEach((layer, index) => {
        if (optionalRecord(layer).role === roles[field])
          options.push({
            path: prefix + "/" + index + "/thickness",
            label:
              label +
              " · " +
              displayName(text(optionalRecord(layer).role)) +
              "厚度",
          });
      });
  }
  if (Array.isArray(cable.cores))
    cable.cores.forEach((core, index) => {
      if (["conductor_diameter", "r20"].includes(field))
        options.push({
          path: `/cable_type/cores/${index}/conductor/${field === "r20" ? "r20" : "diameter"}`,
          label: `线芯 ${index + 1} · ${displayName(field)}`,
        });
      layers(
        optionalRecord(core).layers,
        `/cable_type/cores/${index}/layers`,
        `线芯 ${index + 1}`,
      );
    });
  layers(cable.common_layers, "/cable_type/common_layers", "公共层");
  return options;
}
export function ProposalForm({
  extraction,
  models,
  busy,
  onSubmit,
  onQueue,
}: {
  extraction: Extraction;
  models: Record<string, unknown>[];
  busy: boolean;
  onSubmit: (body: Omit<ProposalInput, "request_id">) => void;
  onQueue?: (body: Omit<ProposalInput, 'request_id'>) => void;
}) {
  const [target, setTarget] = useState("new"),
    [bindings, setBindings] = useState<Record<string, string[]>>({});
  const chosen = models.find((item) => item.id === target),
    payload = optionalRecord(chosen?.payload),
    structured = !!payload.cable_type;
  const adopted =
    extraction.result?.candidates.filter((candidate) =>
      extraction.reviews.some(
        (review) =>
          review.candidate_id === candidate.id && review.action !== "reject",
      ),
    ) || [];
  const fields = [...new Set(adopted.map((item) => item.field))];
  return (
    <form
      className="document-proposal-form"
      aria-label="型号草稿提案"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const value = (name: string) => String(form.get(name) || "").trim();
        const base = {
          extraction_id: extraction.id,
          expected_review_revision: extraction.revision,
          version: value("version"),
        };
        const submit = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'queue' ? onQueue! : onSubmit;
        submit(
          target === "new"
            ? {
                ...base,
                new_model: {
                  name: value("name"),
                  manufacturer: value("manufacturer"),
                  designation: extraction.result!.model.designation,
                  u0_v: Number(value("u0")) * 1000,
                  voltage_v: Number(value("voltage")) * 1000,
                  cores: Number(value("cores")),
                  area_m2: Number(value("area")) * 1e-6,
                  conductor: value("conductor") as "copper_bare",
                  identity_reference: value("identity"),
                },
              }
            : {
                ...base,
                target_model_id: target,
                expected_model_sha256: text(chosen?.digest),
                field_bindings: bindings,
              },
        );
      }}
    >
      <h2>生成型号草稿提案</h2>
      <fieldset disabled={busy}>
        <label>
          目标型号
          <select
            aria-label="目标型号"
            data-request-path="/target_model_id"
            value={target}
            onChange={(event) => {
              setTarget(event.target.value);
              setBindings({});
            }}
          >
            <option value="new">新建型号</option>
            {models.map((item) => (
              <option key={text(item.id)} value={text(item.id)}>
                {text(optionalRecord(item.payload).name)} ·{" "}
                {text(optionalRecord(item.payload).version)}
              </option>
            ))}
          </select>
        </label>
        {target === "new" && (
          <fieldset data-request-path="/new_model" tabIndex={-1}>
            <div className="document-form-grid">
              <label>
                型号名称
                <input
                  name="name"
                  data-request-path="/new_model/name"
                  required
                  maxLength={120}
                  defaultValue={
                    extraction.result?.model.designation +
                    " " +
                    extraction.result?.model.specification
                  }
                />
              </label>
              <label>
                厂家
                <input name="manufacturer" data-request-path="/new_model/manufacturer" required maxLength={120} />
              </label>
              <label>
                相对地电压（kV）
                <input
                  name="u0"
                  data-request-path="/new_model/u0_v"
                  type="number"
                  min="0.001"
                  step="any"
                  required
                />
              </label>
              <label>
                额定电压（kV）
                <input
                  name="voltage"
                  data-request-path="/new_model/voltage_v"
                  type="number"
                  min="0.001"
                  step="any"
                  required
                />
              </label>
              <label>
                芯数
                <input
                  name="cores"
                  data-request-path="/new_model/cores"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  required
                />
              </label>
              <label>
                每芯截面（mm²）
                <input
                  name="area"
                  data-request-path="/new_model/area_m2"
                  type="number"
                  min="0.001"
                  max="10000"
                  step="any"
                  required
                />
              </label>
              <label>
                导体材料
                  <select name="conductor" aria-label="导体材料" data-request-path="/new_model/conductor">
                  <option value="copper_bare">裸铜</option>
                  <option value="copper_coated">镀层铜</option>
                  <option value="aluminium">铝</option>
                </select>
              </label>
            </div>
            <label>
              身份信息原文依据
              <textarea
                name="identity"
                data-request-path="/new_model/identity_reference"
                aria-label="身份信息原文依据"
                rows={2}
                maxLength={2000}
                required
                placeholder="厂家、型号、电压、芯数与导体材料所在页及原文"
              />
            </label>
          </fieldset>
        )}
        {structured &&
          fields.map((field) => (
            <fieldset key={field} data-request-path={'/field_bindings/' + field.replaceAll('~', '~0').replaceAll('/', '~1')} tabIndex={-1}>
              <legend>{displayName(field)} · 写入位置</legend>
              {bindingOptions(payload, field).map((option) => (
                <label className="document-checkbox" key={option.path}>
                  <input
                    type="checkbox"
                    checked={(bindings[field] || []).includes(option.path)}
                    onChange={(event) =>
                      setBindings((current) => ({
                        ...current,
                        [field]: event.target.checked
                          ? [...(current[field] || []), option.path]
                          : (current[field] || []).filter(
                              (path) => path !== option.path,
                            ),
                      }))
                    }
                  />
                  {option.label}
                </label>
              ))}
              {!bindingOptions(payload, field).length && (
                <p className="field-error">
                  当前结构没有对应位置，请返回核对并拒绝此项，或新建公开规格草稿。
                </p>
              )}
            </fieldset>
          ))}
        <label>
          新版本名称
          <input
            name="version"
            data-request-path="/version"
            required
            maxLength={32}
            placeholder="厂家资料核对稿"
          />
        </label>
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={
            structured && fields.some((field) => !bindings[field]?.length)
          }
        >
          生成提案
        </Button>
        {onQueue && target === 'new' && <Button type="submit" name="mode" value="queue" disabled={busy}>加入多规格批量</Button>}
      </fieldset>
    </form>
  );
}

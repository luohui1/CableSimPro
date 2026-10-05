import { useState } from "react";
import { displayName } from "@/lib/display-names";
import { optionalRecord, text, numeric } from "@/api/client";
import type { ParameterDraft } from "@/lib/study-config";
import { NumberField } from "./ui/number-field";
import { Select } from "./ui/select";
import { Button } from "./ui/button";
import { EmptyState } from "./states";
import {
  parameterUnit,
  engineeringQuantity,
  engineeringInputPrecision,
} from "@/lib/format";

function expanded(schema: unknown, root: unknown): Record<string, unknown> {
  let value = optionalRecord(schema);
  const ref = text(value.$ref);
  if (ref.startsWith("#/")) {
    let target: unknown = root;
    for (const part of ref.slice(2).split("/"))
      target = optionalRecord(target)[part];
    value = { ...optionalRecord(target), ...value };
  }
  if (Array.isArray(value.anyOf)) {
    const branch = value.anyOf.find(
      (item) => optionalRecord(item).type !== "null",
    );
    value = { ...expanded(branch, root), ...value };
  }
  return value;
}
export function contractDefaults(
  schema: unknown,
  root: unknown = schema,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(
    optionalRecord(expanded(schema, root).properties),
  )) {
    const field = expanded(raw, root);
    if (field.default !== undefined)
      result[key] = structuredClone(field.default);
    else if (field.type === "object" && field.properties) {
      const nested = contractDefaults(field, root);
      if (Object.keys(nested).length) result[key] = nested;
    }
  }
  return result;
}
export function ContractFields({
  module,
  schema,
  root,
  values,
  prefix,
  readOnly,
  onChange,
  draftFields = {},
  onDraftChange = () => {},
  sources = {},
}: {
  module: string;
  schema: unknown;
  root: unknown;
  values: Record<string, unknown>;
  prefix: string;
  readOnly: boolean;
  onChange: (path: string, value: unknown) => void;
  draftFields?: Record<string, ParameterDraft>;
  onDraftChange?: (field: ParameterDraft | undefined, key: string) => void;
  sources?: Record<string, { kind?: string }>;
}) {
  const model = expanded(schema, root);
  const properties = optionalRecord(model.properties);
  if (!Object.keys(properties).length)
    return <EmptyState description="" title="该能力没有单独的方法参数" />;
  return (
    <div className="parameter-fields">
      {Object.entries(properties).map(([key, raw]) => {
        const field = expanded(raw, root),
          path = prefix + "/" + key,
          value = values[key],
          label = displayName(key, text(field.title) || key);
        const required =
          Array.isArray(model.required) && model.required.includes(key);
        if (
          field.type === "object" &&
          Object.keys(optionalRecord(field.properties)).length &&
          prefix.split("/").length < 5
        )
          return (
            <section key={path} className="input-section">
              <h2>{label}</h2>
              <ContractFields
                module={module}
                schema={field}
                root={root}
                values={optionalRecord(value)}
                prefix={path}
                readOnly={readOnly}
                onChange={onChange}
                draftFields={draftFields}
                onDraftChange={onDraftChange}
                sources={sources}
              />
            </section>
          );
        if (Array.isArray(field.enum))
          return (
            <Select
              key={path}
              label={label}
              value={typeof value === "string" ? value : undefined}
              disabled={readOnly}
              options={field.enum
                .filter((item): item is string => typeof item === "string")
                .map((item) => ({ value: item, label: displayName(item, item) }))}
              onChange={(item) => onChange(path, item)}
            />
          );
        if (field.type === "number" || field.type === "integer") {
          const originalUnit = parameterUnit(key, field);
          const presentation = engineeringQuantity(
            key,
            numeric(value),
            originalUnit,
          );
          const spec = {
            path,
            label,
            unit: presentation.unit,
            scale: presentation.scale,
            offset: presentation.offset,
            fullPrecision: presentation.original,
            required,
            precision:
              field.type === "integer"
                ? 0
                : engineeringInputPrecision(key, numeric(value), originalUnit),
            min:
              engineeringQuantity(
                key,
                numeric(field.minimum) ?? numeric(field.exclusiveMinimum),
                originalUnit,
              ).value ?? undefined,
            minExclusive: numeric(field.exclusiveMinimum) !== null,
            max:
              engineeringQuantity(key, numeric(field.maximum), originalUnit)
                .value ?? undefined,
          };
          const draftKey = module + path;
          return (
            <div key={path} className="parameter-field">
              <NumberField
                {...spec}
                value={presentation.value}
                integer={field.type === "integer"}
                locked={readOnly}
                source={
                  sources["/parameters" + path]?.kind === "user"
                    ? "user"
                    : undefined
                }
                sourceDetail={text(field.description) || "单位未声明"}
                draftText={readOnly ? undefined : draftFields?.[draftKey]?.text}
                onDraftChange={
                  readOnly
                    ? undefined
                    : (raw) =>
                        onDraftChange(
                          raw === undefined
                            ? undefined
                            : {
                                module,
                                path,
                                text: raw,
                                kind:
                                  field.type === "integer"
                                    ? "integer"
                                    : "number",
                                spec,
                              },
                          draftKey,
                        )
                }
                onCommit={(number) => {
                  const storage =
                    number === presentation.value
                      ? numeric(value)
                      : number === null
                        ? null
                        : (number - presentation.offset) / presentation.scale;
                  if (storage === numeric(value)) {
                    onDraftChange(undefined, draftKey);
                    return;
                  }
                  onChange(
                    path,
                    storage === null && !required ? undefined : storage,
                  );
                  onDraftChange(undefined, draftKey);
                }}
              />
              {value === undefined &&
                field.default !== undefined &&
                !readOnly && (
                  <Button
                    variant="ghost"
                    size="compact"
                    onClick={() => onChange(path, field.default)}
                  >
                    采用契约默认值
                  </Button>
                )}
            </div>
          );
        }
        if (field.type === "boolean")
          return (
            <label key={path} className="run-ack">
              <input
                type="checkbox"
                checked={value === true}
                disabled={readOnly}
                onChange={(event) => onChange(path, event.target.checked)}
              />
              {label}
            </label>
          );
        if (field.type === "string" && !field.const)
          return (
            <label key={path} className="text-field">
              {label}
              <input
                value={text(value)}
                readOnly={readOnly}
                onChange={(event) => onChange(path, event.target.value)}
              />
            </label>
          );
        return (
          <JsonField
            key={path}
            module={module}
            path={path}
            label={label}
            value={value}
            readOnly={readOnly}
            onCommit={(value) => onChange(path, value)}
            draftFields={draftFields}
            onDraftChange={onDraftChange}
          />
        );
      })}
    </div>
  );
}
function JsonField({
  module,
  path,
  label,
  value,
  readOnly,
  onCommit,
  draftFields,
  onDraftChange,
}: {
  module: string;
  path: string;
  label: string;
  value: unknown;
  readOnly: boolean;
  onCommit: (value: unknown) => void;
  draftFields: Record<string, ParameterDraft>;
  onDraftChange: (field: ParameterDraft | undefined, key: string) => void;
}) {
  const key = module + path;
  const draft = readOnly ? undefined : draftFields?.[key]?.text;
  const [error, setError] = useState("");
  function commit() {
    try {
      onCommit(JSON.parse(draft || "null"));
      onDraftChange(undefined, key);
      setError("");
    } catch {
      setError("请输入有效 JSON；原值保留。");
    }
  }
  return (
    <label className="text-field">
      {label}
      <textarea
        value={draft ?? JSON.stringify(value ?? null, null, 2)}
        readOnly={readOnly}
        aria-invalid={!!error}
        onChange={(event) =>
          onDraftChange(
            { module, path, text: event.target.value, kind: "json" },
            key,
          )
        }
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.ctrlKey || event.metaKey) &&
            !readOnly
          ) {
            event.preventDefault();
            event.stopPropagation();
            commit();
          }
          if (event.key === "Escape") {
            onDraftChange(undefined, key);
            setError("");
          }
        }}
      />
      {draft !== undefined && (
        <Button size="compact" onClick={commit}>
          确认参数
        </Button>
      )}
      {error && (
        <span role="alert" className="field-error">
          {error}
        </span>
      )}
    </label>
  );
}

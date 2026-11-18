import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

// FastAPI 0.128.2 can assign the bare Selection name to any of three models.
// Use official operation/field anchors, not set iteration order, without changing their schemas.
function normalizeSelectionComponentNames(document) {
  const prefix = "#/components/schemas/";
  const schemas = document.components?.schemas;
  if (!schemas || typeof schemas !== "object" || Array.isArray(schemas))
    throw new Error("正式 OpenAPI 缺少组件定义");
  const renames = new Map();
  const targets = new Set();
  const at = (path) => path.reduce((value, key) => value?.[key], document);
  function bind(canonical, path, accepted) {
    const reference = at(path)?.$ref;
    const source = typeof reference === "string" && reference.startsWith(prefix)
      ? reference.slice(prefix.length) : null;
    const definition = source && schemas[source];
    if (!source || !accepted.includes(source) || !definition ||
        definition.title !== "Selection" || Object.hasOwn(definition, "$ref"))
      throw new Error("正式 OpenAPI 的 Selection 用途锚点或别名未知：" + path.join("/"));
    if (renames.has(source) || targets.has(canonical))
      throw new Error("正式 OpenAPI 的 Selection 用途指向同一组件");
    renames.set(source, canonical);
    targets.add(canonical);
  }
  bind("Selection",
    ["paths", "/api/type-library/exchange/export", "post", "requestBody", "content", "application/json", "schema"],
    ["Selection", "backend__kernel__type_library_exchange__Selection"]);
  bind("backend__kernel__datasheet_contracts__Selection",
    ["components", "schemas", "ExtractionScope-Input", "properties", "selections", "items"],
    ["Selection", "backend__kernel__datasheet_contracts__Selection"]);
  bind("Selection-Output",
    ["components", "schemas", "ExtractionScope-Output", "properties", "selections", "items"],
    ["Selection-Output", "backend__kernel__datasheet_contracts__Selection-Output"]);
  bind("backend__kernel__resource_data__Selection",
    ["paths", "/api/library/resources/select", "post", "requestBody", "content", "application/json", "schema"],
    ["Selection", "backend__kernel__resource_data__Selection"]);
  const input = at(["components", "schemas", "ExtractionScope-Input", "properties", "selections", "items"]);
  if (at(["components", "schemas", "ExtractionRequest", "properties", "selections", "items"])?.$ref !== input.$ref)
    throw new Error("正式 OpenAPI 的资料提取选择组件不一致");
  for (const [name, definition] of Object.entries(schemas)) {
    if ((definition.title === "Selection" || /^(?:Selection(?:-(?:Input|Output))?|backend__kernel__(?:datasheet_contracts|type_library_exchange|resource_data)__Selection(?:-(?:Input|Output))?)$/.test(name)) &&
        !renames.has(name))
      throw new Error("正式 OpenAPI 存在未识别的 Selection 组件或别名：" + name);
    if (targets.has(name) && !renames.has(name))
      throw new Error("正式 OpenAPI 的稳定组件名已被其它定义占用：" + name);
  }
  function reference(value) {
    if (!value.startsWith(prefix)) return value;
    const [name, ...tail] = value.slice(prefix.length).split("/");
    return prefix + (renames.get(name) ?? name) + (tail.length ? "/" + tail.join("/") : "");
  }
  // Example/default values are data, including any literal $ref they contain.
  // Property maps have arbitrary keys; a property named "default" is still a schema.
  const literalKeys = new Set(["default", "const", "enum", "example", "examples"]);
  const mapKeys = new Set(["schemas", "properties", "patternProperties", "$defs", "definitions", "content", "paths", "responses", "headers", "requestBodies"]);
  function rewrite(value, propertyMap = false) {
    if (Array.isArray(value)) return value.map((item) => rewrite(item));
    if (!value || typeof value !== "object") return value;
    const result = Object.create(null);
    for (const [key, child] of Object.entries(value)) {
      if (!propertyMap && literalKeys.has(key)) result[key] = child;
      else if (key === "$ref" && typeof child === "string") result[key] = reference(child);
      else result[key] = rewrite(child, !propertyMap && mapKeys.has(key));
    }
    if (!propertyMap && value.discriminator?.mapping) {
      result.discriminator.mapping = Object.fromEntries(
        Object.entries(value.discriminator.mapping).map(([key, target]) => [
          key, typeof target === "string" ? renames.get(target) ?? reference(target) : target,
        ]),
      );
    }
    return result;
  }
  const normalized = rewrite(document);
  // Rename simultaneously, including a bare name moving between different models.
  // Keep existing input aliases after definitions, as the generator already emits them.
  const inputAlias = ([name, value]) => Object.keys(value).length === 1 && value.$ref === prefix + name + "-Input";
  normalized.components.schemas = Object.fromEntries(
    Object.entries(normalized.components.schemas)
      .map(([name, value]) => [renames.get(name) ?? name, value])
      .sort((a, b) => Number(inputAlias(a)) - Number(inputAlias(b)) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  );
  if (Object.keys(normalized.components.schemas).length !== Object.keys(schemas).length)
    throw new Error("正式 OpenAPI 组件重命名发生覆盖");
  return normalized;
}

const root = fileURLToPath(new URL("../", import.meta.url));
const base = process.env.BACKEND_URL || "http://127.0.0.1:8040";
const response = await fetch(`${base}/openapi.json`);
if (!response.ok) throw new Error(`正式 OpenAPI 读取失败：${response.status}`);
const schema = normalizeSelectionComponentNames(await response.json());
// The generic 404 handler is not a business endpoint and repeats operationId across methods.
delete schema.paths["/api/{path}"];
// Preserve stable input type aliases when FastAPI publishes separate Input/Output names.
// Each alias remains a direct reference to the official schema; no fields are invented.
for(const name of Object.keys(schema.components?.schemas||{})){
  if(name.endsWith("-Input")){
    const alias=name.slice(0,-6);
    if(!schema.components.schemas[alias])schema.components.schemas[alias]={$ref:"#/components/schemas/"+name};
  }
}
const directory = path.join(root, "src/api/generated");
const checking = process.argv.includes('--check');
if (!checking) await fs.mkdir(directory, { recursive: true });
async function output(name, text) {
  if (checking) {
    if ((await fs.readFile(path.join(directory, name), 'utf8')).replaceAll('\r\n', '\n') !== text.replaceAll('\r\n', '\n'))
      throw Error(name + ' 与正式宿主 OpenAPI 不一致，请重新生成客户端');
  } else await fs.writeFile(path.join(directory, name), text);
}
const code = astToString(
  await openapiTS(schema, { defaultNonNullable: false }),
);
await output(
  "schema.ts",
  "// Generated from the formal host OpenAPI. Run npm run generate:api; do not edit.\n" +
    code,
);
await output(
  "endpoints.ts",
  "// Generated from the formal host OpenAPI. Do not edit.\nexport const endpoints = " +
    JSON.stringify(
      Object.fromEntries(
        Object.entries(schema.paths).map(([key, methods]) => [
          key,
          Object.keys(methods).filter((method) =>
            ["get", "post", "put", "patch", "delete"].includes(method),
          ),
        ]),
      ),
      null,
      2,
    ) +
    " as const;\n",
);
if (!checking) {
await fs.mkdir(path.join(root, "../.data/frontend-integration"), {
  recursive: true,
});
await fs.writeFile(
  path.join(root, "../.data/frontend-integration/openapi.json"),
  JSON.stringify(schema),
);
}
console.log(
  `已${checking ? '核对' : '从正式宿主生成'}请求、响应及路径类型：${Object.keys(schema.paths).length} 条路径。`,
);

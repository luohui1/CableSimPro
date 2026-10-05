import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = process.env.BACKEND_URL || "http://127.0.0.1:8040";
const response = await fetch(`${base}/openapi.json`);
if (!response.ok) throw new Error(`正式 OpenAPI 读取失败：${response.status}`);
const schema = await response.json();
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
await fs.mkdir(directory, { recursive: true });
const code = astToString(
  await openapiTS(schema, { defaultNonNullable: false }),
);
await fs.writeFile(
  path.join(directory, "schema.ts"),
  "// Generated from the formal host OpenAPI. Run npm run generate:api; do not edit.\n" +
    code,
);
await fs.writeFile(
  path.join(directory, "endpoints.ts"),
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
await fs.mkdir(path.join(root, "../.data/frontend-integration"), {
  recursive: true,
});
await fs.writeFile(
  path.join(root, "../.data/frontend-integration/openapi.json"),
  JSON.stringify(schema),
);
console.log(
  `已从正式宿主生成请求、响应及路径类型：${Object.keys(schema.paths).length} 条路径。`,
);

// 列出插件清单 JSON Schema（plugin-spec/manifest.schema.json）中指定对象的字段、类型与是否必填。
import schema from '@/.generated/manifest-schema.json';

type Node = Record<string, unknown>;

function typeOf(node: Node | undefined): string {
  if (!node) return '任意';
  if (typeof node.$ref === 'string') return node.$ref.split('/').pop() ?? '任意';
  if (node.const !== undefined) return JSON.stringify(node.const);
  if (Array.isArray(node.enum)) return node.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (Array.isArray(node.anyOf)) return [...new Set(node.anyOf.map((n) => typeOf(n as Node)))].join(' | ');
  if (node.type === 'array') return `${typeOf(node.items as Node | undefined)}[]`;
  if (node.type === 'object' && node.additionalProperties && typeof node.additionalProperties === 'object') {
    return `{ 键: ${typeOf(node.additionalProperties as Node)} }`;
  }
  return typeof node.type === 'string' ? node.type : '任意';
}

export function ManifestFields({ def }: { def?: string }) {
  const root = schema as unknown as Node;
  const defs = (root.$defs ?? {}) as Record<string, Node>;
  const target: Node | undefined = def ? defs[def] : root;
  if (!target) throw new Error(`manifest.schema.json 中没有 ${def}`);
  const req = new Set<string>(Array.isArray(target.required) ? (target.required as string[]) : []);
  const props = (target.properties ?? {}) as Record<string, Node>;
  const rows = Object.entries(props).map(([key, node]) => ({
    key,
    type: typeOf(node),
    required: req.has(key),
  }));

  return (
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>字段</th>
            <th>类型</th>
            <th>必填</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                <code>{row.key}</code>
              </td>
              <td>
                <code>{row.type}</code>
              </td>
              <td>{row.required ? '是' : '否'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

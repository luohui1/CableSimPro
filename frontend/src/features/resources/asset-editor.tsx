import { useEffect, useId, useRef, useState } from 'react';
import { message } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { propertyLabel, referenceCitation, referenceData, referenceNumber } from '@/lib/reference-data';
import { findAssetVersion, getAsset, saveAsset, uncertainWrite } from './api';
import { assetKinds, assetUnit, comparableRelease, parameterPresets, quantityKinds, sourceKinds, validIdentifier, validVersion,
  type Asset, type AssetKind, type AssetRelease, type Dimension } from './definitions';
import './resources.css';

const RECEIPT = 'cablesim:resource-edit-pending';
type Receipt = { token: string; release: AssetRelease; previous?: Asset };
type Parameter = { key: string; name: string; value: string; dimension: Dimension; unit: string; overridable: boolean };
type Source = AssetRelease['sources'][number] & { key: string; retained: boolean };
type FieldIssue = { field: string; message: string };
export function rememberAssetEdit(release: AssetRelease, previous?: Asset): Receipt {
  const receipt = { token: crypto.randomUUID(), release, previous };
  sessionStorage.setItem(RECEIPT, JSON.stringify(receipt));
  return receipt;
}
export function forgetAssetEdit(token: string) {
  try { if (JSON.parse(sessionStorage.getItem(RECEIPT) || 'null')?.token === token) sessionStorage.removeItem(RECEIPT); } catch { /* Keep a malformed receipt for manual recovery; never send another write here. */ }
}
export function pendingAssetEdit(): Receipt | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(RECEIPT) || 'null');
    return value && typeof value.token === 'string' && value.release && validIdentifier(value.release.asset_id) &&
      validVersion(value.release.version) && value.release.kind in assetKinds && Array.isArray(value.release.sources) ? value : null;
  } catch { return null; }
}
const key = () => crypto.randomUUID();
function newDefinition(kind: AssetKind): AssetRelease {
  return { asset_id: `local.${kind}.${key()}`, version: '1.0.0', kind, name: '', parameters: [], dependencies: [], files: [],
    geometry_recipe: null, sources: [{ kind: 'project_input', reference: '', reviewed: false }] };
}
function sourceRows(release: AssetRelease): Source[] {
  return release.sources.map(source => ({ ...source, key: key(), retained: referenceData([source]).other.length === 0 }));
}
function parameterRows(release: AssetRelease): Parameter[] {
  return (release.parameters || []).map(parameter => ({ key: key(), name: parameter.name, value: String(parameter.quantity.value),
    dimension: parameter.quantity.dimension, unit: parameter.quantity.unit, overridable: parameter.overridable ?? false }));
}
const units: Record<string, [number, number]> = { m: [1, 0], mm: [0.001, 0], m2: [1, 0], mm2: [0.000001, 0],
  K: [1, 0], degC: [1, 273.15], delta_K: [1, 0], delta_degC: [1, 0], 'ohm/m': [1, 0], 'ohm/km': [0.001, 0] };
function convert(value: string, from: string, to: string) {
  if (!value.trim() || !Number.isFinite(Number(value))) return value;
  const [a, b] = units[from] || [1, 0], [c, d] = units[to] || [1, 0];
  return String((Number(value) * a + b - d) / c);
}

/** Draft-only typed editing. Unknown outcomes keep the exact input and identity until read back. */
export function AssetEditor({ open, onClose, onSaved, kinds, asset, resume }: {
  open: boolean; onClose: () => void; onSaved: (asset: Asset) => void; kinds: AssetKind[]; asset?: Asset; resume?: Receipt | null;
}) {
  const original = useRef(resume?.release || asset?.release || newDefinition(kinds[0]));
  const previous = useRef(resume?.previous || asset);
  const [name, setName] = useState(original.current.name), [kind, setKind] = useState(original.current.kind), [version, setVersion] = useState(original.current.version);
  const [parameters, setParameters] = useState(() => parameterRows(original.current)), [sources, setSources] = useState(() => sourceRows(original.current));
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [receipt, setReceipt] = useState<Receipt | null>(resume || null), [retryAllowed, setRetryAllowed] = useState(false);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const editor = useRef<HTMLDivElement>(null), fieldPrefix = useId();
  const mounted = useRef(true), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!validationAttempt) return;
    // Radix keeps focus inside the dialog; move it to the actual invalid input
    // after its accessible error description has rendered, including long forms.
    const field = editor.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    field?.focus({ preventScroll: true });
    field?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [validationAttempt]);
  const locked = busy || !!receipt;
  const issues: FieldIssue[] = [];
  const issue = (field: string, message: string) => issues.push({ field, message });
  if (!name.trim() || name.trim().length > 128) issue('name', '请填写 1 至 128 个字符的资源名称。');
  if (!validVersion(version)) issue('version', '版本号请使用三段数字，例如 1.0.0；不能覆盖已有版本。');
  const names = new Set<string>();
  for (const [index, row] of parameters.entries()) {
    if (!validIdentifier(row.name)) issue(`${row.key}-name`, `参数 ${index + 1}：标识需以字母或数字开头，只能包含字母、数字及 _ . : / -，最多 128 个字符。`);
    else if (names.has(row.name)) issue(`${row.key}-name`, `参数 ${index + 1}：${propertyLabel(row.name)}重复，请选择其他参数或移除此项。`);
    names.add(row.name);
    if (!row.value.trim() || !Number.isFinite(Number(row.value))) issue(`${row.key}-value`, `参数 ${index + 1}：请填写有限数值，例如 1.2 或 1.2e-3，并核对单位。`);
    else if (row.dimension === 'absolute_temperature' && Number(convert(row.value, row.unit, 'K')) < 0)
      issue(`${row.key}-value`, `参数 ${index + 1}：温度不能低于${row.unit === 'degC' ? ' −273.15 °C' : ' 0 K'}（绝对零度）。`);
    if (!(quantityKinds[row.dimension].units as string[]).includes(row.unit)) issue(`${row.key}-unit`, `参数 ${index + 1}：单位与量纲不匹配，请重新选择单位。`);
  }
  if (!sources.length) issue('sources', '至少登记一条真实来源；工程师手工输入也需说明用途与依据。');
  for (const [index, source] of sources.entries())
    if (!source.reference.trim() || source.reference.length > 512) issue(`${source.key}-source`, `来源 ${index + 1}：请填写 1 至 512 个字符的真实出处。`);
  const fieldError = (field: string) => validationAttempt ? issues.find(item => item.field === field)?.message : undefined;
  const errorId = (field: string) => `${fieldPrefix}-${field}-error`;
  const missingSources = sources.filter(source => !source.reference.trim()).length;
  const missing = [!name.trim() && '资源名称', !sources.length && '至少一条真实来源', missingSources > 0 && `${missingSources} 条来源说明`].filter(Boolean);
  const missingReason = !receipt && missing.length ? `还需填写${missing.join('、')}，然后保存资源草稿。` : '';
  const showIssues = !receipt && validationAttempt > 0 && issues.length > 0;
  function clearReceipt(token: string) {
    if (!mounted.current) return;
    forgetAssetEdit(token);
    setReceipt(null);
  }
  function definition(): AssetRelease {
    if (issues.length) throw new Error(issues[0].message);
    const values = parameters.map(row => {
      return { name: row.name, quantity: { value: Number(row.value), unit: row.unit, dimension: row.dimension }, overridable: row.overridable };
    });
    const references = sources.map(source => {
      return { kind: source.kind, reference: source.reference.trim(), reviewed: source.reviewed };
    });
    return { ...original.current, name: name.trim(), kind, version, parameters: values, sources: references };
  }
  async function write(frozen?: Receipt) {
    if (pending.current) return;
    if (!frozen && issues.length) {
      setError(''); setValidationAttempt(attempt => attempt + 1);
      return;
    }
    pending.current = true; setBusy(true); setError('');
    let attempt = frozen;
    let sent = false;
    try {
      attempt ||= { token: key(), release: definition(), previous: previous.current };
      // Persist before sending: navigation or a lost response must not allocate another identity.
      sessionStorage.setItem(RECEIPT, JSON.stringify(attempt));
      setReceipt(attempt); setRetryAllowed(false);
      sent = true;
      const saved = await saveAsset(attempt.release, attempt.previous);
      if (!mounted.current) return;
      clearReceipt(attempt.token); onSaved(saved);
    } catch (problem) {
      if (!mounted.current) return;
      if (attempt && sent && (uncertainWrite(problem) || !!frozen)) {
        setReceipt(attempt); setError(`${message(problem)}。保存结果尚未确认；请核实原版本，输入已保留，不能另建一份代替。`);
      } else {
        if (attempt) clearReceipt(attempt.token);
        setError(message(problem));
      }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function verify() {
    if (!receipt || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const current = receipt.previous ? await getAsset(receipt.previous.id) : await findAssetVersion(receipt.release.asset_id, receipt.release.version);
      if (!mounted.current) return;
      if (current && comparableRelease(current.release) === comparableRelease(receipt.release)) {
        clearReceipt(receipt.token); onSaved(current);
      } else if (!current || receipt.previous && current.revision === receipt.previous.revision && current.content_sha256 === receipt.previous.content_sha256) {
        setRetryAllowed(true); setError('尚未读到这次保存。可继续核实，或按原版本、原内容重试；原请求若已完成，系统会阻止重复创建或覆盖。');
      } else {
        setRetryAllowed(false); setError('服务器版本已变化，内容与待保存输入不同。请保留本记录并核对版本历史，不能直接覆盖。');
      }
    } catch (problem) { if (mounted.current) setError(`核实失败：${message(problem)}。待确认输入仍保留。`); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  function changeParameter(id: string, patch: Partial<Parameter>) { setParameters(rows => rows.map(row => row.key === id ? { ...row, ...patch } : row)); setError(''); }
  function addParameter() {
    const preset = parameterPresets.find(row => row.name === (kind === 'installation' ? 'burial_depth' : kind === 'rule' ? 'conductor_limit' : 'thermal_resistivity'))!;
    setParameters(rows => [...rows, { key: key(), name: preset.name, dimension: preset.dimension, unit: quantityKinds[preset.dimension].units[0], value: '', overridable: false }]);
  }
  const title = previous.current ? '编辑资源草稿' : '新建资源';
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }} title={title}
    description={receipt ? '原保存请求尚待核实；关闭后可从资源页恢复同一份输入。' : '填写资源定义与真实出处。保存后为草稿，核对与发布由你分别确认。'} initialFocus={receipt ? 'action' : 'form'}
    fallbackFocus={() => document.getElementById('resource-search')}
    actions={receipt ? <><Button variant="primary" loading={busy} onClick={() => void verify()}>核实保存结果</Button>{retryAllowed && <Button disabled={busy} onClick={() => void write(receipt)}>按原内容重试保存</Button>}</>
      : <Button variant="primary" loading={busy} onClick={() => void write()} disabled={!!missingReason}
        aria-describedby={missingReason ? `${fieldPrefix}-missing` : undefined}>保存资源草稿</Button>}>
    {error && <p role="alert" className="field-error">{error}</p>}
    {showIssues && <p role="alert" className="field-error" data-resource-validation>有 {issues.length} 项需要修改。{issues[0].message}</p>}
    {missingReason && <p role="status" className="muted" id={`${fieldPrefix}-missing`} data-resource-required>{missingReason}</p>}
    {busy && <p className="muted">正在处理当前请求。关闭后原输入和版本会保留，可从资源页核实结果。</p>}
    <div ref={editor} className="resource-editor" data-resource-form={previous.current ? 'edit' : 'create'}>
      <div className="resource-form-grid">
        <label className="text-field">资源名称<Input aria-label="资源名称" aria-required="true" aria-invalid={!!fieldError('name')}
          aria-describedby={fieldError('name') ? errorId('name') : undefined} value={name} maxLength={128} disabled={locked} onChange={event => { setName(event.target.value); setError(''); }} />
          {fieldError('name') && <span className="field-error" id={errorId('name')}>{fieldError('name')}</span>}</label>
        <Select label="资源类别" value={kind} disabled={locked || !!previous.current} onChange={value => setKind(value as AssetKind)} options={(previous.current || resume ? [kind] : kinds).map(value => ({ value, label: assetKinds[value] }))} />
        <label className="text-field">版本号<Input aria-label="版本号" aria-required="true" aria-invalid={!!fieldError('version')}
          aria-describedby={fieldError('version') ? errorId('version') : undefined} value={version} disabled={locked || !!previous.current} maxLength={64} onChange={event => setVersion(event.target.value)} />
          {fieldError('version') && <span className="field-error" id={errorId('version')}>{fieldError('version')}</span>}</label>
      </div>
      {previous.current && <p className="muted">当前为第 {previous.current.revision} 次修订。类别和版本标识固定；升级版本请从已发布版本派生。</p>}
      <section aria-label="资源参数" className="resource-form-section"><h3>参数与单位</h3>
        {!parameters.length && <p className="muted">尚未登记参数。可新增参数，也可先保存带有来源的定义草稿；缺少的物性不会补默认值。</p>}
        {parameters.map((row, index) => {
          const preset = parameterPresets.find(item => item.name === row.name);
          return <fieldset className="resource-parameter" key={row.key}><legend>参数 {index + 1}</legend><div className="resource-form-grid">
            <Select label={`参数 ${index + 1}`} value={preset ? row.name : 'custom'} disabled={locked} error={preset ? fieldError(`${row.key}-name`) : undefined} onChange={value => {
              const chosen = parameterPresets.find(item => item.name === value);
              changeParameter(row.key, chosen ? { name: chosen.name, dimension: chosen.dimension, unit: quantityKinds[chosen.dimension].units[0], value: '' } : { name: '', value: '' });
            }} options={[...parameterPresets.map(item => ({ value: item.name, label: item.label })), { value: 'custom', label: '自定义参数' }]} />
            {!preset && <label className="text-field">参数标识<Input aria-label={`参数标识 ${index + 1}`} aria-required="true" aria-invalid={!!fieldError(`${row.key}-name`)}
              aria-describedby={fieldError(`${row.key}-name`) ? errorId(`${row.key}-name`) : undefined} value={row.name} disabled={locked} maxLength={128} placeholder="字母、数字及点、下划线等" onChange={event => changeParameter(row.key, { name: event.target.value })} />
              {fieldError(`${row.key}-name`) && <span className="field-error" id={errorId(`${row.key}-name`)}>{fieldError(`${row.key}-name`)}</span>}</label>}
            {!preset && <Select label={`量纲 ${index + 1}`} value={row.dimension} disabled={locked} onChange={value => { const dimension = value as Dimension; changeParameter(row.key, { dimension, unit: quantityKinds[dimension].units[0], value: '' }); }} options={Object.entries(quantityKinds).map(([value, detail]) => ({ value, label: detail.label }))} />}
            <label className="text-field">数值<Input aria-label={`参数数值 ${index + 1}`} aria-required="true" aria-invalid={!!fieldError(`${row.key}-value`)}
              aria-describedby={fieldError(`${row.key}-value`) ? errorId(`${row.key}-value`) : undefined} inputMode="decimal" value={row.value} disabled={locked} onChange={event => changeParameter(row.key, { value: event.target.value })} />
              {fieldError(`${row.key}-value`) && <span className="field-error" id={errorId(`${row.key}-value`)}>{fieldError(`${row.key}-value`)}</span>}</label>
            <Select label={`单位 ${index + 1}`} value={row.unit} disabled={locked} error={fieldError(`${row.key}-unit`)} onChange={value => changeParameter(row.key, { unit: value, value: convert(row.value, row.unit, value) })} options={quantityKinds[row.dimension].units.map(value => ({ value, label: assetUnit(value) }))} />
          </div><div className="resource-form-row"><label><Checkbox checked={row.overridable} disabled={locked} onCheckedChange={value => changeParameter(row.key, { overridable: value === true })} aria-label={`允许研究覆盖参数 ${index + 1}`} /> 允许引用方显式覆盖</label>
            <Button size="compact" disabled={locked} onClick={() => setParameters(rows => rows.filter(item => item.key !== row.key))}>移除参数 {index + 1}</Button></div></fieldset>;
        })}
        <Button size="compact" disabled={locked || parameters.length >= 256} onClick={addParameter}>新增参数</Button>
        <p className="muted">切换同量纲单位会换算数值并保持物理量。当前版本可录入长度、面积、温度、温差、线电阻、热阻率、热导率、电流和频率；密度、电阻率及无量纲参数暂不能录入。</p>
      </section>
      <section aria-label="资源来源" className="resource-form-section"><h3>来源</h3>{sources.map((source, index) => {
        const references = referenceData([source]);
        return <fieldset className="resource-source" key={source.key}><legend>来源 {index + 1} · {source.reviewed ? '原始来源已核对' : '原始来源待核对'}</legend>
          <Select label={`来源类别 ${index + 1}`} value={source.kind} disabled={locked || source.retained} onChange={value => setSources(rows => rows.map(item => item.key === source.key ? { ...item, kind: value as Source['kind'], reviewed: false } : item))} options={Object.entries(sourceKinds).map(([value, detail]) => ({ value, label: detail.label }))} />
          {source.retained ? <><div className="resource-retained-source">{references.values.map((value, i) => <p key={i}>{propertyLabel(value.property)}：{referenceNumber(value.value)} {assetUnit(value.unit)} · {referenceCitation(value)}{value.condition ? ` · ${value.condition}` : ''}</p>)}
            {references.editions.map((edition, i) => <p key={i}>{edition.standard} · {edition.edition} · {edition.scope}</p>)}
            {references.gaps.map((gap, i) => <p key={i}>{gap.properties.map(propertyLabel).join('、')}：{gap.reason}</p>)}</div>
            <p className="muted">此条是带有固定出处的标准摘录，按原文保留。需要替换时，请重新填写出处。</p><Button size="compact" disabled={locked}
              aria-invalid={!!fieldError(`${source.key}-source`)} aria-describedby={fieldError(`${source.key}-source`) ? errorId(`${source.key}-source`) : undefined}
              onClick={() => setSources(rows => rows.map(item => item.key === source.key ? { ...item, reference: '', reviewed: false, retained: false } : item))}>替换来源 {index + 1}</Button></>
            : <label className="text-field">来源说明<textarea aria-label={`来源说明 ${index + 1}`} aria-required="true" aria-invalid={!!fieldError(`${source.key}-source`)}
              aria-describedby={fieldError(`${source.key}-source`) ? errorId(`${source.key}-source`) : undefined} value={source.reference} maxLength={512} disabled={locked} placeholder="资料名称、版本、条款或页码；手工输入需写明工程用途和依据" onChange={event => setSources(rows => rows.map(item => item.key === source.key ? { ...item, reference: event.target.value, reviewed: false } : item))} /></label>}
          {fieldError(`${source.key}-source`) && <p className="field-error" id={errorId(`${source.key}-source`)}>{fieldError(`${source.key}-source`)}</p>}
          <Button size="compact" disabled={locked || sources.length === 1} title={sources.length === 1 ? '每份资源至少保留一条来源' : undefined} onClick={() => setSources(rows => rows.filter(item => item.key !== source.key))}>移除来源 {index + 1}</Button>
        </fieldset>;
      })}<Button size="compact" disabled={locked || sources.length >= 64} onClick={() => setSources(rows => [...rows, { key: key(), kind: 'project_input', reference: '', reviewed: false, retained: false }])}>新增来源</Button>
        <p className="muted">至少保留一条真实出处。修改出处会恢复“待核对”；资源审核不自动提升原始资料的可信度。</p>
      </section>
      {!!original.current.dependencies?.length && <details><summary>保留 {original.current.dependencies.length} 个固定版本依赖</summary><ul>{original.current.dependencies.map(dependency => <li key={dependency.asset_id}>{dependency.asset_id} · {dependency.version}<br />内容摘要：{dependency.content_sha256}</li>)}</ul></details>}
      {original.current.geometry_recipe && <p className="muted">本资源包含结构几何定义，本次编辑保留全部几何内容。</p>}
      {receipt && <p className="muted">为核实同一请求，表单暂不可修改。此处可关闭，稍后从“恢复未确认保存”继续。</p>}
    </div>
  </Dialog>;
}

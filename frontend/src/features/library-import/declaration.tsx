import { useRef, useState } from 'react';
import { optionalRecord, text } from '@/api/client';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { displayUnit } from '@/lib/display-names';
import { confidenceText, methodText, sourceLocationText, type Field, type SeriesDeclaration, type Vocabulary } from './api';
import { MaterialDeclarations } from './material-declaration';

export function emptyDeclaration(): SeriesDeclaration {
  return { name: '', manufacturer: '', designation: '', cores: 3, u0_v: 0, u_v: 0, standards: [], origin: 'factory', resistance_basis: 'stated', common: {}, common_basis: {}, modelling: {} };
}
const numberOf = (value: string) => value.trim() === '' || !Number.isFinite(Number(value)) ? undefined : Number(value);
const PARTS = [
  { id: 'conductor', label: '导体', matches: (key: string) => key === 'r20' || key.startsWith('conductor_') && !key.includes('screen') },
  { id: 'insulation', label: '绝缘与屏蔽', matches: (key: string) => key.includes('insulation') || key.includes('screen') },
  { id: 'protection', label: '保护层与外径', matches: (key: string) => !key.startsWith('conductor_') && !key.includes('insulation') && !key.includes('screen') && key !== 'r20' },
];
const RATING_FIELDS = [
  { key: 'normal_temperature_k', label: '正常运行许可温限' },
  { key: 'short_circuit_temperature_k', label: '短路许可温限' },
  { key: 'conductor_class', label: '导体类别' },
];
const LIMIT_LABELS: Record<string, string> = { normal_temperature: '正常运行温限', short_circuit_temperature: '短路温限', short_circuit_duration: '最长短路时限' };
const ratingUnit = (unit: unknown) => typeof unit === 'string' && unit ? unit === 'degC' ? '°C' : displayUnit(unit) : '单位未声明';
const limitText = (value: unknown) => {
  const item = optionalRecord(value);
  return `${item.criterion === 'maximum' ? '≤ ' : ''}${typeof item.value === 'number' && Number.isFinite(item.value) ? item.value : '数值未声明'} ${ratingUnit(item.unit)}`;
};
const limitationsOf = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function RatingSource({ value }: { value: unknown }) {
  const source = optionalRecord(value), url = text(source.url);
  return <div className="library-import-issues">
    <p>出处：{text(source.title) || '资料名称未声明'}{text(source.file) && ` · ${text(source.file)}`}{text(source.location) && ` · ${sourceLocationText(text(source.location))}`}</p>
    <p>原件页码：印刷第 {typeof source.printed_page === 'number' ? source.printed_page : '未注明'} 页 · PDF 第 {typeof source.pdf_page === 'number' ? source.pdf_page : '未注明'} 页。</p>
    <p>原件 SHA-256：<code className="library-import-digest">{text(source.sha256) || '未声明'}</code></p>
    {/^https?:\/\//.test(url) && <p><a className="library-import-source-url" href={url} target="_blank" rel="noopener noreferrer">查看来源原件</a></p>}
  </div>;
}

function RatingReference({ reference, field }: { reference: string; field: string }) {
  let parsed: Record<string, unknown> = {};
  try { parsed = optionalRecord(JSON.parse(reference)); } catch { /* A manufacturer's own source may be plain text. */ }
  const transcribed = parsed.semantic === 'manufacturer_limit' && Object.hasOwn(LIMIT_LABELS, text(parsed.quantity));
  const conversion = optionalRecord(parsed.conversion), duration = optionalRecord(parsed.conditions).short_circuit_duration;
  const expression = text(conversion.expression);
  const shownExpression = expression === 'T/K = t/degC + 273.15' ? '开尔文温度（K）= 摄氏温度（°C）+273.15' : expression;
  const download = () => {
    const url = URL.createObjectURL(new Blob([reference], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${field}-source.txt`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="library-import-stack">
    {transcribed ? <>
      <p>原文项目：{LIMIT_LABELS[text(parsed.quantity)]} {limitText(parsed)} · 厂家许可上限。</p>
      {duration !== undefined && <p>原文适用条件：最长短路时限 {limitText(duration)}。</p>}
      <p>转录方法：{methodText(parsed.method)}；换算：{methodText(conversion)}{shownExpression && ` · ${shownExpression}`}。</p>
      <RatingSource value={parsed.source} />
      {limitationsOf(parsed.limitations).map((item, index) => <p key={index}>{item}</p>)}
    </> : <p>{reference || '出处未声明，预览将保留缺项或拒绝。'}</p>}
    <p className="muted">原始出处按上传文本保存；展示与下载不表示已认证或工程批准。</p>
    {!!reference && <div><Button type="button" onClick={download}>下载完整声明出处</Button></div>}
  </div>;
}

function DeclaredRatings({ value }: { value: SeriesDeclaration }) {
  const fields = RATING_FIELDS.filter(field => value.modelling[field.key] !== undefined);
  const published = optionalRecord(value.reference?.published_operating_limits), limits = optionalRecord(published.limits);
  if (!fields.length && !Object.keys(published).length) return null;
  return <section className="library-import-common" aria-label="已声明的额定条件">
    <h2>已声明的额定条件</h2>
    <p>以下保留本次声明的数值、单位与出处；许可温限不是研究实际运行温度，最长短路时限不是本次故障持续时间。研究输入须另行明确。</p>
    {fields.map(field => <div className="library-import-common-item" key={field.key}>
      <p><strong>{field.label}：</strong>{String(value.modelling[field.key].value)} {ratingUnit(value.modelling[field.key].unit)}</p>
      <details className="library-import-explanation"><summary>{field.label}完整出处</summary>
        <RatingReference reference={value.modelling[field.key].reference} field={field.key} />
      </details>
    </div>)}
    {!!Object.keys(published).length && <section className="library-import-common-item" aria-label="公开手册许可上限">
      <h3>公开手册声明的许可上限</h3>
      <p>原手册限值供对照，不替代上方本次声明，也不填入研究工况。</p>
      {Object.entries(LIMIT_LABELS).filter(([key]) => limits[key] !== undefined).map(([key, label]) => <p key={key}>{label}：{limitText(limits[key])}</p>)}
      <p>转录方法：{methodText(published.method)} · 可信分档：{confidenceText(published.confidence)} · {published.reviewed === false ? '尚未人工审核' : published.reviewed === true ? '原来源标记已审核，本次入库仍须人工确认' : '审核状态未声明'}。</p>
      {limitationsOf(published.limitations).map((item, index) => <p key={index}>{item}</p>)}
      <details className="library-import-explanation"><summary>手册原件位置与完整摘要</summary><RatingSource value={published.source} /></details>
    </section>}
  </section>;
}

export function DeclarationForm({ value, onChange, vocabulary, mapped }: {
  value: SeriesDeclaration; onChange: (value: SeriesDeclaration) => void; vocabulary: Vocabulary; mapped: Set<string>;
}) {
  const [part, setPart] = useState('conductor');
  const [sourceError, setSourceError] = useState(''), [sourceNotice, setSourceNotice] = useState(''), [loadingSource, setLoadingSource] = useState(false);
  const sourcePicker = useRef<HTMLInputElement>(null), currentValue = useRef(value);
  currentValue.current = value;
  const originalStandards = Array.isArray(value.reference?.original_standards) ? value.reference.original_standards.filter((item): item is string => typeof item === 'string') : [];
  const set = (values: Partial<SeriesDeclaration>) => onChange({ ...value, ...values });
  async function loadSource(file: File | undefined) {
    if (!file || loadingSource) return;
    setLoadingSource(true); setSourceError(''); setSourceNotice('');
    try {
      if (!/\.json$/i.test(file.name) || !file.size || file.size > 1024 * 1024) throw new Error('请选择非空且不超过 1 MiB 的 JSON 来源说明。');
      const parsed: unknown = JSON.parse(await file.text());
      const object = (candidate: unknown): candidate is Record<string, unknown> => candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate) && Object.keys(candidate).length > 0;
      if (!object(parsed)) throw new Error('来源说明必须是非空 JSON 对象，不能是数组、空对象或单个值。');
      const source = 'source' in parsed ? parsed.source : parsed;
      if (!object(source)) throw new Error('来源说明的 source 字段必须是非空对象。');
      for (const key of ['title', 'location', 'sha256', 'file', 'url', 'locator']) {
        if (source[key] !== undefined && typeof source[key] !== 'string') throw new Error('资料名称、位置、摘要、文件名及网址须使用文本，请核对来源说明。');
      }
      onChange({ ...currentValue.current, source });
      setSourceNotice(`已加载“${file.name}”。请在预览中核对原列口径、原件定位与限制。`);
    } catch (error) {
      setSourceError(error instanceof SyntaxError ? '来源说明不是有效 JSON，请检查文件格式。' : error instanceof Error ? error.message : '来源说明读取失败，请重新选择文件。');
    } finally {
      setLoadingSource(false);
      if (sourcePicker.current) sourcePicker.current.value = '';
    }
  }
  const common = (key: string, text: string) => {
    const next = { ...value.common }, number = numberOf(text);
    if (number === undefined) delete next[key]; else next[key] = number;
    set({ common: next });
  };
  const fieldRow = (field: Field) => <div className="library-import-value" key={field.key}>
    <label htmlFor={`library-common-${field.key}`}>{field.label}<span className="unit"> / {displayUnit(field.unit)}</span></label>
    <Input id={`library-common-${field.key}`} aria-label={`声明${field.label}`} type="number" min="0" step="any" placeholder="未提供" value={value.common[field.key] ?? ''} onChange={event => common(field.key, event.target.value)} />
    <Input aria-label={`${field.label}依据`} placeholder="原表注释、图纸编号或标准条款" required={value.common[field.key] !== undefined} value={value.common_basis[field.key] || ''} onChange={event => set({ common_basis: { ...value.common_basis, [field.key]: event.target.value } })} />
  </div>;
  return <div className="library-import-stack">
    {value.source?.title && <p className="library-import-source">来源：{value.source.title}{value.source.location && `；${sourceLocationText(value.source.location)}`}</p>}
    {!Object.keys(value.modelling).length && <p className="muted">计算参数与来源尚未提供；预览将保留缺项，需补齐后才能计算。</p>}
    <div className="library-import-fields">
      <label className="text-field">系列名称<Input aria-label="系列名称" required maxLength={120} value={value.name} onChange={event => set({ name: event.target.value })} /></label>
      <label className="text-field">制造商<Input aria-label="制造商" maxLength={120} value={value.manufacturer} onChange={event => set({ manufacturer: event.target.value })} /></label>
      <label className="text-field">型号<Input aria-label="型号" required maxLength={60} value={value.designation} onChange={event => set({ designation: event.target.value })} /></label>
      <label className="text-field">额定相电压 U₀ / kV<Input aria-label="额定相电压 kV" required type="number" min="0.001" step="any" value={value.u0_v ? value.u0_v / 1000 : ''} onChange={event => set({ u0_v: (numberOf(event.target.value) ?? 0) * 1000 })} /></label>
      <label className="text-field">额定线电压 U / kV<Input aria-label="额定线电压 kV" required type="number" min="0.001" step="any" value={value.u_v ? value.u_v / 1000 : ''} onChange={event => set({ u_v: (numberOf(event.target.value) ?? 0) * 1000 })} /></label>
      <Select label="芯数" value={String(value.cores)} onChange={cores => set({ cores: Number(cores) })} options={Array.from({ length: 16 }, (_, index) => index + 1).map(cores => ({ value: String(cores), label: `${cores} 芯` }))} />
      <Select label="数据身份" value={value.origin} onChange={origin => set({ origin: origin as SeriesDeclaration['origin'] })} options={[{ value: 'factory', label: '本厂结构表' }, { value: 'public', label: '公开厂家资料' }, { value: 'demo', label: '结构演示' }]} />
      <Select label="铠装材料类别" value={value.armour_material || ''} onChange={armour_material => set({ armour_material: armour_material || undefined })} options={[{ value: '', label: '未声明具体钢材' }, { value: 'steel_galvanized', label: '镀锌钢' }, { value: 'steel_stainless_nonmagnetic', label: '非磁性不锈钢' }]} />
      <label className="text-field">最高系统电压 Uₘ / kV<Input aria-label="最高系统电压 kV" type="number" min="0.001" step="any" value={value.um_v ? value.um_v / 1000 : ''} onChange={event => set({ um_v: numberOf(event.target.value) === undefined ? undefined : Number(event.target.value) * 1000 })} /></label>
      <Select label="导体材料" value={value.conductor || ''} onChange={next => set({ conductor: next as SeriesDeclaration['conductor'] || undefined })} options={[{ value: '', label: '按明确型号识别' }, { value: 'copper', label: '铜' }, { value: 'aluminium', label: '铝' }]} />
      <Select label="绝缘材料" value={value.insulation || ''} onChange={next => set({ insulation: next as SeriesDeclaration['insulation'] || undefined })} options={[{ value: '', label: '按明确型号识别' }, { value: 'XLPE', label: '交联聚乙烯' }, { value: 'PVC', label: '聚氯乙烯' }]} />
      <Select label="外护套材料" value={value.oversheath || ''} onChange={next => set({ oversheath: next as SeriesDeclaration['oversheath'] || undefined })} options={[{ value: '', label: '按明确型号识别' }, { value: 'PVC', label: '聚氯乙烯' }, { value: 'PE', label: '聚乙烯' }]} />
      <Select label="金属套材料与形式" value={value.metal_sheath || ''} onChange={next => set({ metal_sheath: next as SeriesDeclaration['metal_sheath'] || undefined })} options={[{ value: '', label: '未声明或无金属套' }, { value: 'lead', label: '铅套' }, { value: 'corrugated_aluminium', label: '皱纹铝套' }, { value: 'smooth_aluminium', label: '光滑铝套' }]} />
    </div>
    <Select label="原表缺少导体电阻时" value={value.resistance_basis || 'stated'} onChange={next => set({ resistance_basis: next as SeriesDeclaration['resistance_basis'] })} options={[{ value: 'stated', label: '保留缺项，等待厂家提供' }, { value: 'standard_limit', label: '采用 GB/T 3956 表 2 标准上限' }]} />
    {value.resistance_basis === 'standard_limit' && <p className="library-import-source">明确采用 GB/T 3956—2008 表 2 的导体直流电阻上限。它是标准上限，不是厂家实测值；表外规格保持缺项。</p>}
    <label className="text-field">执行标准（每行一项，包含年号）<Textarea aria-label="执行标准" value={value.standards.join('\n')} onChange={event => set({ standards: event.target.value.split('\n') })} onBlur={() => set({ standards: value.standards.map(item => item.trim()).filter(Boolean) })} /></label>
    {originalStandards.length > 0 && <p className="library-import-source">原手册声明：{originalStandards.join('；')}。本次采用的执行标准列在上方，请核对版本变化及其适用范围。</p>}
    {!value.source?.sha256 && <div className="library-import-fields library-import-fields-pair">
      <label className="text-field">资料名称<Input aria-label="资料名称" placeholder="厂家结构表或产品手册全名" value={value.source?.title || ''} onChange={event => set({ source: { ...value.source, title: event.target.value } })} /></label>
      <label className="text-field">资料位置<Input aria-label="资料位置" placeholder="原始表号、版本或页码" value={value.source?.location || ''} onChange={event => set({ source: { ...value.source, location: event.target.value } })} /></label>
    </div>}
    <details className="library-import-details">
      <summary>补充原列口径与原件定位</summary>
      <div className="library-import-stack">
        <p className="muted">加载来源说明只替换本次资料来源，不自动填充结构、材料物性、执行标准或工况。之后仍需逐行预览并确认入库。</p>
        <p className="muted">支持不超过 1 MiB 的非空 JSON 来源对象；文件带有 source 字段时，只读取该来源对象。原列含义、单位、定位与限制按原文保存。</p>
        <div><Button type="button" loading={loadingSource} onClick={() => sourcePicker.current?.click()}>加载来源说明（JSON）</Button></div>
        <Input ref={sourcePicker} type="file" hidden tabIndex={-1} aria-label="来源说明 JSON 文件" accept=".json,application/json" disabled={loadingSource} onChange={event => void loadSource(event.target.files?.[0])} />
        {sourceError && <p role="alert" className="field-error">{sourceError}</p>}
        {sourceNotice && <p role="status">{sourceNotice}</p>}
      </div>
    </details>
    <DeclaredRatings value={value} />
    <section className="library-import-stack" aria-label="全系列统一尺寸">
      <h2>全系列统一尺寸</h2>
      <p className="muted">原表已有的列按逐行数值导入；其余尺寸需写明取值依据。未提供的参数保留缺项。</p>
      <Tabs value={part} onValueChange={setPart}>
        <TabsList aria-label="结构部位">{PARTS.map(item => <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>)}</TabsList>
        {PARTS.map(item => {
          const fields = vocabulary.fields.filter(field => !['area', 'weight'].includes(field.key) && item.matches(field.key));
          const tableFields = fields.filter(field => mapped.has(field.key));
          return <TabsContent key={item.id} value={item.id} className="library-import-stack">
            {tableFields.length > 0 && <p className="muted">原表已有：{tableFields.map(field => field.label).join('、')}。</p>}
            {fields.filter(field => !mapped.has(field.key)).map(fieldRow)}
          </TabsContent>;
        })}
      </Tabs>
    </section>
    <details className="library-import-details">
      <summary>计算参数与来源</summary>
      <div className="library-import-stack">
        <p className="muted">这些参数参与计算，不由导入器猜测。点击下方按钮只补充未声明项目，已有数值与出处全部保留；补充后请逐项核对适用范围，需改值时在对应字段明确编辑。</p>
        <div><Button type="button" onClick={() => set({ modelling: { ...structuredClone(vocabulary.reference_modelling), ...value.modelling } })}>补充尚未声明的参考参数</Button></div>
        {vocabulary.modelling.map(field => <div className="library-import-value" key={field.key}>
          <label htmlFor={`library-model-${field.key}`}>{field.label}<span className="unit"> / {displayUnit(field.unit)}</span></label>
          <Input id={`library-model-${field.key}`} aria-label={`参数${field.label}`} value={value.modelling[field.key]?.value ?? ''} onChange={event => {
            const modelling = { ...value.modelling }, raw = event.target.value;
            if (raw === '') delete modelling[field.key];
            else modelling[field.key] = { value: numberOf(raw) ?? raw, reference: modelling[field.key]?.reference || '' };
            set({ modelling });
          }} />
          <Textarea aria-label={`${field.label}参数依据`} required={!!value.modelling[field.key]} placeholder="参数的出处与适用条件" value={value.modelling[field.key]?.reference || ''} onChange={event => {
            const current = value.modelling[field.key];
            if (current) set({ modelling: { ...value.modelling, [field.key]: { ...current, reference: event.target.value } } });
          }} />
        </div>)}
      </div>
    </details>
    <MaterialDeclarations value={value.material_properties} onChange={material_properties => {
      const next = { ...value };
      if (material_properties) next.material_properties = material_properties;
      else delete next.material_properties;
      onChange(next);
    }} />
  </div>;
}

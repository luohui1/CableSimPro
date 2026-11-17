import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export interface RatingFormValue {
  name: string; layout: string; depth_m: string; soil_rho_k_m_w: string;
  ambient_temperature_c: string; frequency_hz: string; bonding: string; spacing_m: string;
  source: string; ks: string; kp: string; eddy: string; parameter_source: string;
}
export const emptyRating = (cores: number): RatingFormValue => ({ name: '', layout: cores === 3 ? 'three_core_buried_single' : 'trefoil', depth_m: '', soil_rho_k_m_w: '', ambient_temperature_c: '', frequency_hz: '', bonding: '', spacing_m: '', source: '', ks: '', kp: '', eddy: '', parameter_source: '' });
const needsSpacing = (value: RatingFormValue) => ['flat', 'three_core_buried_horizontal'].includes(value.layout);
export const ratingReady = (value: RatingFormValue) => [value.name, value.layout, value.depth_m, value.soil_rho_k_m_w, value.ambient_temperature_c, value.frequency_hz, value.bonding, value.source, value.ks, value.kp, value.eddy, value.parameter_source, ...(needsSpacing(value) ? [value.spacing_m] : [])].every(value => value.trim() !== '');

export function ratingRequest(value: RatingFormValue) {
  const fields = { depth_m: '中心埋深', soil_rho_k_m_w: '土壤热阻率', ambient_temperature_c: '环境温度', frequency_hz: '交流频率', ks: '集肤效应系数', kp: '邻近效应系数' };
  for (const [field, label] of Object.entries(fields)) if (!value[field as keyof RatingFormValue].trim() || !Number.isFinite(Number(value[field as keyof RatingFormValue]))) throw new Error(`请填写有效的${label}。`);
  if (needsSpacing(value) && !value.spacing_m.trim()) throw new Error('水平排列须明确中心距，单位 m。');
  if (value.spacing_m && (!Number.isFinite(Number(value.spacing_m)) || Number(value.spacing_m) <= 0)) throw new Error('中心距须为正数，单位 m。');
  return {
    rows: [{ case_id: 'library-condition', name: value.name.trim(), layout: value.layout, depth_m: Number(value.depth_m), soil_rho_k_m_w: Number(value.soil_rho_k_m_w), ambient_temperature_c: Number(value.ambient_temperature_c), frequency_hz: Number(value.frequency_hz), bonding: value.bonding, spacing_m: needsSpacing(value) ? Number(value.spacing_m) : null, rating_basis: 'simultaneous', source: value.source.trim() }],
    parameters: { ks: Number(value.ks), kp: Number(value.kp), eddy: value.eddy, source: value.parameter_source.trim() },
  };
}

export function RatingForm({ value, onChange, cores }: { value: RatingFormValue; onChange: (value: RatingFormValue) => void; cores: number }) {
  const set = (field: keyof RatingFormValue, next: string) => onChange({ ...value, [field]: next });
  const numberField = (field: keyof RatingFormValue, label: string, unit: string) => <label className="text-field" key={field}>{label} / {unit}<Input aria-label={`${label} ${unit}`} type="number" step="any" required value={value[field]} onChange={event => set(field, event.target.value)} /></label>;
  return <div className="library-import-stack">
    <h2>统一计算工况</h2>
    <p className="muted">本次只计算以下明确条件。数值和来源随每个规格的运行保存；方法不覆盖或缺参时逐规格拒算。</p>
    <label className="text-field">工况名称<Input aria-label="工况名称" required value={value.name} onChange={event => set('name', event.target.value)} /></label>
    <div className="library-import-fields library-import-fields-pair">
      <Select label="敷设排列" value={value.layout} onChange={next => set('layout', next)} options={cores === 3 ? [{ value: 'three_core_buried_single', label: '三芯直埋 · 单回' }, { value: 'three_core_buried_horizontal', label: '三芯直埋 · 三回水平' }] : [{ value: 'trefoil', label: '单芯直埋 · 接触品字' }, { value: 'flat', label: '单芯直埋 · 水平' }]} />
      <Select label="金属套接地" value={value.bonding} onChange={next => set('bonding', next)} options={[{ value: '', label: '请选择接地方式' }, { value: 'both_ends', label: '两端接地' }, { value: 'single_point', label: '单点接地' }]} />
      {numberField('depth_m', '中心埋深', 'm')}
      {numberField('soil_rho_k_m_w', '土壤热阻率', 'K·m/W')}
      {numberField('ambient_temperature_c', '环境温度', '°C')}
      {numberField('frequency_hz', '交流频率', 'Hz')}
      <label className="text-field">中心距 / m（水平排列须明确）<Input aria-label="中心距 m" type="number" min="0.001" step="any" required={needsSpacing(value)} disabled={!needsSpacing(value)} value={needsSpacing(value) ? value.spacing_m : ''} onChange={event => set('spacing_m', event.target.value)} /></label>
    </div>
    <label className="text-field">工况来源<Textarea aria-label="工况来源" required placeholder="项目设计条件、试验记录或样本页码" value={value.source} onChange={event => set('source', event.target.value)} /></label>
    <h2>方法参数</h2>
    <div className="library-import-fields library-import-fields-pair">
      {numberField('ks', '集肤效应系数 kₛ', '1')}
      {numberField('kp', '邻近效应系数 kₚ', '1')}
      <Select label="护套涡流损耗" value={value.eddy} onChange={next => set('eddy', next)} options={[{ value: '', label: '请明确计算假设' }, { value: 'ignored', label: '明确忽略（须核对适用条件）' }, { value: 'trefoil', label: '按品字排列计入' }]} />
    </div>
    <label className="text-field">方法参数来源<Textarea aria-label="方法参数来源" required placeholder="标准条款、厂家资料或明确假设的依据" value={value.parameter_source} onChange={event => set('parameter_source', event.target.value)} /></label>
  </div>;
}

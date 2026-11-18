import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export interface RatingFormValue {
  name: string; layout: string; depth_m: string; soil_rho_k_m_w: string;
  ambient_temperature_c: string; frequency_hz: string; bonding: string; spacing_m: string;
  source: string; ks: string; kp: string; eddy: string; t4_form: string; parameter_source: string;
  initial_sheath_temperature_c: string; current_tolerance_a: string; max_iterations: string;
}
export const emptyRating = (cores: number): RatingFormValue => ({ name: '', layout: cores === 3 ? 'three_core_buried_single' : 'trefoil', depth_m: '', soil_rho_k_m_w: '', ambient_temperature_c: '', frequency_hz: '', bonding: '', spacing_m: '', source: '', ks: '', kp: '', eddy: '', t4_form: '', parameter_source: '', initial_sheath_temperature_c: '', current_tolerance_a: '', max_iterations: '' });
const needsSpacing = (value: RatingFormValue) => ['flat', 'three_core_buried_horizontal'].includes(value.layout);
export const ratingReady = (value: RatingFormValue) => [value.name, value.layout, value.depth_m, value.soil_rho_k_m_w, value.ambient_temperature_c, value.frequency_hz, value.bonding, value.source, value.ks, value.kp, value.eddy, value.t4_form, value.parameter_source, value.initial_sheath_temperature_c, value.current_tolerance_a, value.max_iterations, ...(needsSpacing(value) ? [value.spacing_m] : [])].every(value => value.trim() !== '');

export function ratingRequest(value: RatingFormValue) {
  const fields = { depth_m: '中心埋深', soil_rho_k_m_w: '土壤热阻率', ambient_temperature_c: '环境温度', frequency_hz: '交流频率', ks: '集肤效应系数', kp: '邻近效应系数', initial_sheath_temperature_c: '护套初始温度', current_tolerance_a: '电流收敛容差', max_iterations: '最大迭代次数' };
  for (const [field, label] of Object.entries(fields)) if (!value[field as keyof RatingFormValue].trim() || !Number.isFinite(Number(value[field as keyof RatingFormValue]))) throw new Error(`请填写有效的${label}。`);
  if (!['exact', 'simplified'].includes(value.t4_form)) throw new Error('请明确选择土壤热阻公式。');
  if (Number(value.initial_sheath_temperature_c) < -20 || Number(value.initial_sheath_temperature_c) > 150) throw new Error('护套初始温度须在 −20 至 150 °C 范围内。');
  if (Number(value.current_tolerance_a) <= 0 || Number(value.current_tolerance_a) > 10) throw new Error('电流收敛容差须大于 0 且不大于 10 A。');
  if (!Number.isInteger(Number(value.max_iterations)) || Number(value.max_iterations) < 1 || Number(value.max_iterations) > 500) throw new Error('最大迭代次数须为 1 至 500 的整数。');
  if (needsSpacing(value) && !value.spacing_m.trim()) throw new Error('水平排列须明确中心距，单位 m。');
  if (value.spacing_m && (!Number.isFinite(Number(value.spacing_m)) || Number(value.spacing_m) <= 0)) throw new Error('中心距须为正数，单位 m。');
  return {
    rows: [{ case_id: 'library-condition', name: value.name.trim(), layout: value.layout, depth_m: Number(value.depth_m), soil_rho_k_m_w: Number(value.soil_rho_k_m_w), ambient_temperature_c: Number(value.ambient_temperature_c), frequency_hz: Number(value.frequency_hz), bonding: value.bonding, spacing_m: needsSpacing(value) ? Number(value.spacing_m) : null, rating_basis: 'simultaneous', source: value.source.trim() }],
    parameters: { ks: Number(value.ks), kp: Number(value.kp), eddy: value.eddy, t4_form: value.t4_form,
      solver: { initial_sheath_temperature_c: Number(value.initial_sheath_temperature_c), current_tolerance_a: Number(value.current_tolerance_a), max_iterations: Number(value.max_iterations) },
      source: value.parameter_source.trim() },
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
      <Select label="土壤热阻公式" value={value.t4_form} onChange={next => set('t4_form', next)} options={[{ value: '', label: '请选择公式形式' }, { value: 'exact', label: '精确式' }, { value: 'simplified', label: '简化式（须核对适用条件）' }]} />
    </div>
    <h2>求解初值与收敛控制</h2>
    <p className="muted">初始温度用于迭代起点，不能作为厂家实测温度。请明确计算精度与迭代上限；未收敛时保留失败原因。</p>
    <div className="library-import-fields library-import-fields-pair">
      {numberField('initial_sheath_temperature_c', '护套初始温度', '°C')}
      {numberField('current_tolerance_a', '电流收敛容差', 'A')}
      {numberField('max_iterations', '最大迭代次数', '次')}
    </div>
    <label className="text-field">方法参数来源<Textarea aria-label="方法参数来源" required placeholder="标准条款、厂家资料或明确假设的依据" value={value.parameter_source} onChange={event => set('parameter_source', event.target.value)} /></label>
  </div>;
}

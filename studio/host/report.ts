// The calculation sheet: one self-contained, printable HTML file rendered from a run record.
// It only restates what the record holds; nothing is recomputed here.
import { BONDING_NAMES, compact, EDDY_NAMES, fixed, KIND_NAMES, PHASE_NAMES, STATE_NAMES } from '../shared/format.ts';
import { cableShape, fit, heat, sectionShape } from '../shared/geometry.ts';
import type { CableState, DomainDocument, RunRecord, Summary } from '../shared/types.ts';

const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
const cell = (value: unknown, numeric = false): string => `<td${numeric ? ' class="n"' : ''}>${escape(value)}</td>`;
const table = (head: string[], rows: string[][], numeric: number[] = []): string =>
  `<table><thead><tr>${head.map(item => `<th>${escape(item)}</th>`).join('')}</tr></thead><tbody>${rows.map(row =>
    `<tr>${row.map((item, index) => cell(item, numeric.includes(index))).join('')}</tr>`).join('')}</tbody></table>`;
const pairs = (rows: [string, unknown][]): string =>
  `<dl>${rows.filter(([, value]) => value !== undefined && value !== null && value !== '').map(([label, value]) =>
    `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`;
const list = (items: string[]): string => items.length ? `<ul>${items.map(item => `<li>${escape(item)}</li>`).join('')}</ul>` : '<p>无。</p>';

function cableName(id: string, document: DomainDocument): string {
  for (const circuit of document.circuits) {
    const cable = circuit.cables.find(item => item.id === id);
    if (cable) return `${circuit.label} · ${PHASE_NAMES[cable.phase] ?? cable.phase}`;
  }
  return id;
}

export function sectionSvg(document: DomainDocument, states: CableState[] = [], ambient = 0, width = 640, height = 360): string {
  const section = document.sections[0];
  const { cables, bounds, shape } = sectionShape(document);
  const view = fit(bounds, width, height, { top: 44, right: 70, bottom: 40, left: 96 });
  const byId = new Map(states.map(state => [state.id, state]));
  const parts: string[] = [];
  const ground = view.y(0);
  parts.push(`<rect x="0" y="${ground}" width="${width}" height="${height - ground}" fill="#f4f1ea"/>`);
  parts.push(`<line x1="0" y1="${ground}" x2="${width}" y2="${ground}" stroke="#555" stroke-width="1.5"/>`);
  parts.push(`<text x="12" y="${ground - 8}" class="t">地表</text>`);
  if (section.backfill) {
    const region = section.backfill;
    parts.push(`<rect x="${view.x(region.x - region.width / 2)}" y="${view.y(region.z + region.height / 2)}" width="${region.width * view.scale}" height="${region.height * view.scale}" fill="#e3e6ea" stroke="#8a929c" stroke-dasharray="5 4"/>`);
  }
  for (const enclosure of section.enclosures ?? []) {
    parts.push(`<circle cx="${view.x(enclosure.x)}" cy="${view.y(enclosure.z)}" r="${(enclosure.outer_diameter ?? 0) / 2 * view.scale}" fill="#fff" stroke="#6b7280" stroke-width="${Math.max(1, ((enclosure.outer_diameter ?? 0) - (enclosure.inner_diameter ?? 0)) / 2 * view.scale)}"/>`);
  }
  const conductor = shape.rings.filter(ring => ring.role === 'conductor');
  for (const cable of cables) {
    const state = byId.get(cable.id);
    const cx = view.x(cable.x), cy = view.y(cable.z);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${cable.radius * view.scale}" fill="#d9dde3" stroke="#374151"/>`);
    for (const ring of conductor) {
      parts.push(`<circle cx="${cx + ring.cx * view.scale}" cy="${cy - ring.cz * view.scale}" r="${ring.outer * view.scale}" fill="${state ? heat(state.conductor_c, ambient, state.limit_c) : '#b8793a'}"/>`);
    }
  }
  // Labels sit beside the group so they never cover a cable.
  const right = view.x(bounds.right) + 10;
  cables.forEach((cable, index) => {
    const state = byId.get(cable.id);
    const label = `${cables.length > 3 ? cable.circuitLabel + ' ' : ''}${PHASE_NAMES[cable.phase] ?? cable.phase}${state ? ` ${fixed(state.conductor_c)} °C` : ''}`;
    parts.push(`<text x="${right}" y="${view.y(bounds.top) + 36 + index * 18}" class="t">${escape(label)}</text>`);
  });
  const depth = section.layout_template?.depth;
  if (depth) {
    const x = view.x(bounds.left) - 34;
    parts.push(`<path d="M${x} ${ground}V${view.y(-depth)}M${x - 5} ${ground}h10M${x - 5} ${view.y(-depth)}h10" stroke="#111" fill="none"/>`);
    parts.push(`<text x="${x - 8}" y="${(ground + view.y(-depth)) / 2 + 4}" class="t" text-anchor="end">埋深 ${compact(depth)} m</text>`);
  }
  const spacing = section.layout_template?.spacing;
  if (spacing && cables.length > 1) {
    const y = view.y(bounds.bottom) + 22;
    const [a, b] = [...cables].sort((p, q) => p.x - q.x).slice(-2);
    parts.push(`<path d="M${view.x(a.x)} ${y}H${view.x(b.x)}M${view.x(a.x)} ${y - 5}v10M${view.x(b.x)} ${y - 5}v10" stroke="#111" fill="none"/>`);
    parts.push(`<text x="${(view.x(a.x) + view.x(b.x)) / 2}" y="${y + 16}" class="t" text-anchor="middle">中心距 ${compact(spacing * 1000)} mm</text>`);
  }
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="敷设截面"><style>.t{font:13px sans-serif;fill:#111}</style>${parts.join('')}</svg>`;
}

function cableTable(record: RunRecord): string {
  const cable = record.inputs.cable.payload.cable_type;
  const materials = record.inputs.cable.payload.materials;
  const shape = cableShape(cable, materials);
  const first = cable.cores[0].id;
  const rows = shape.rings.filter(ring => !ring.core || ring.core === first).map(ring => [
    String(ring.number), ring.name.replace(/^芯 1 · /, ''), materials.find(material => material.id === ring.material)?.label ?? ring.material,
    ring.role === 'conductor' ? `直径 ${compact(ring.size * 1000)}` : compact(ring.size * 1000), compact((Math.hypot(ring.cx, ring.cz) + ring.outer) * 2000, 5)]);
  return table(['序', '结构层', '材料', '厚度 mm', '外径 mm'], rows, [3, 4]);
}

function stateTables(title: string, states: CableState[], document: DomainDocument): string {
  if (!states.length) return '';
  const threeCore = states.some(state => state.thermal_k_m_w.t2 !== undefined);
  const ducted = states.some(state => state.thermal_k_m_w.t4_wall > 0);
  const temperatures = table(['电缆', '电流 A', '导体 °C', '温限 °C', '余量 K', '护套 °C', '表面 °C'], states.map(state => [
    cableName(state.id, document), fixed(state.current_a), fixed(state.conductor_c, 2), fixed(state.limit_c), fixed(state.margin_k, 2),
    fixed(state.sheath_c, 2), fixed(state.surface_c, 2)]), [1, 2, 3, 4, 5, 6]);
  const losses = table(['电缆', '导体损耗', '护套损耗', ...(threeCore ? ['铠装损耗'] : []), '介质损耗', '合计', 'λ1', '交流电阻 Ω/km'], states.map(state => [
    cableName(state.id, document), fixed(state.losses_w_m.conductor, 3), fixed(state.losses_w_m.sheath, 3),
    ...(threeCore ? [fixed(state.losses_w_m.armour, 3)] : []), fixed(state.losses_w_m.dielectric, 3), fixed(state.losses_w_m.total, 3),
    fixed(state.lambda1, 4), compact(state.ac_resistance_ohm_m * 1000, 5)]), [1, 2, 3, 4, 5, 6, 7]);
  const thermal = table(['电缆', 'T1', ...(threeCore ? ['T2'] : []), 'T3', ...(ducted ? ['T4 管内空气', 'T4 管壁'] : []), 'T4 土壤（自身）', '互热温升 K'], states.map(state => [
    cableName(state.id, document), fixed(state.thermal_k_m_w.t1, 4), ...(threeCore ? [fixed(state.thermal_k_m_w.t2, 4)] : []),
    fixed(state.thermal_k_m_w.t3, 4), ...(ducted ? [fixed(state.thermal_k_m_w.t4_air, 4), fixed(state.thermal_k_m_w.t4_wall, 4)] : []),
    fixed(state.thermal_k_m_w.t4_soil, 4), fixed(state.mutual_rise_k, 2)]), [1, 2, 3, 4, 5, 6, 7]);
  return `<h3>${escape(title)}</h3><h4>温度</h4>${temperatures}<h4>损耗 W/m</h4>${losses}<h4>热阻 K·m/W</h4>${thermal}`;
}

function sweepChart(record: RunRecord): string {
  const points = record.sweep!.points.filter(point => typeof point.ampacity_a === 'number');
  if (points.length < 2) return '';
  const [width, height, left, bottom] = [640, 260, 64, 40];
  const xs = points.map(point => point.value), ys = points.map(point => point.ampacity_a!);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const px = (value: number) => left + (value - x0) / (x1 - x0 || 1) * (width - left - 24);
  const py = (value: number) => 20 + (y1 - value) / (y1 - y0 || 1) * (height - bottom - 20);
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${px(point.value)} ${py(point.ampacity_a!)}`).join('');
  const dots = points.map(point => `<circle cx="${px(point.value)}" cy="${py(point.ampacity_a!)}" r="3.5" fill="#1f4e79"/>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="扫描曲线"><style>.t{font:13px sans-serif;fill:#111}</style>
    <path d="M${left} 20V${height - bottom}H${width - 24}" stroke="#555" fill="none"/><path d="${path}" stroke="#1f4e79" stroke-width="2" fill="none"/>${dots}
    <text x="${left - 8}" y="26" class="t" text-anchor="end">${fixed(y1, 0)}</text><text x="${left - 8}" y="${height - bottom}" class="t" text-anchor="end">${fixed(y0, 0)}</text>
    <text x="${left}" y="${height - 18}" class="t">${compact(x0)}</text><text x="${width - 24}" y="${height - 18}" class="t" text-anchor="end">${compact(x1)}</text>
    <text x="${width / 2}" y="${height - 4}" class="t" text-anchor="middle">${escape(record.sweep!.label)} ${escape(record.sweep!.unit)}</text>
    <text x="14" y="14" class="t">允许电流 A</text></svg>`;
}

function results(record: RunRecord): string {
  const document = record.document;
  if (record.kind === 'sweep') {
    const sweep = record.sweep!;
    return `<h2>结果</h2>${sweepChart(record)}${table([`${sweep.label} ${sweep.unit}`, '允许电流 A', '保存负荷下最热导体 °C', '说明'], sweep.points.map(point => [
      compact(point.value), fixed(point.ampacity_a), fixed(point.hottest_conductor_c, 2), point.error?.message ?? (point.within_limit === false ? '保存负荷超过温限' : '')]), [0, 1, 2])}`;
  }
  if (record.kind === 'selection') {
    const selection = record.selection!;
    const chosen = selection.candidates.find(row => row.model_id === selection.chosen);
    return `<h2>结果</h2><p class="lead">${chosen ? `选定 ${escape(chosen.name)}：允许电流 ${fixed(chosen.ampacity_a)} A，目标 ${compact(selection.target_current_a)} A，余量 ${fixed(chosen.margin_a)} A。` : escape(selection.reason)}</p>
      <p>${escape(selection.rule)}</p>${table(['候选型号', '截面 mm²', '允许电流 A', '余量 A', '目标电流下导体 °C', '结论'], selection.candidates.map(row => [
      row.name + (row.model_id === selection.chosen ? '（选定）' : ''), compact(row.area_mm2), fixed(row.ampacity_a), fixed(row.margin_a),
      row.conductor_at_target_c !== undefined ? fixed(row.conductor_at_target_c, 1) : row.at_target_error ? '无稳态解' : '—',
      row.error?.message ?? (row.meets_target ? '满足' : '不满足')]), [1, 2, 3, 4])}`;
  }
  const summary = record.summary as Summary;
  if (summary.status !== 'succeeded' || !document) return `<h2>结果</h2><p class="lead">未算出结果：${escape(summary.error?.message)}</p>`;
  const circuits = table(['回路', '允许电流 A', '保存负荷 A', '余量 A', '限制电缆'], (summary.circuits ?? []).map(circuit => [
    circuit.label, circuit.ampacity_a === null ? circuit.error?.message ?? '—' : fixed(circuit.ampacity_a), fixed(circuit.load_a), fixed(circuit.margin_a),
    circuit.limiting_cable ? cableName(circuit.limiting_cable, document) : '—']), [1, 2, 3]);
  return `<h2>结果</h2><h3>各回路允许电流</h3>${circuits}
    <figure>${sectionSvg(document, summary.operating?.cables ?? [], summary.ambient_c ?? 0)}<figcaption>敷设截面与保存负荷下的导体温度</figcaption></figure>
    ${stateTables('额定工况（限制电缆到达温限）', summary.rated?.cables ?? [], document)}
    ${stateTables('保存负荷工况', summary.operating?.cables ?? [], document)}`;
}

export function renderReport(record: RunRecord): string {
  const { cable, installation, conditions, method } = record.inputs;
  const card = record.method_card;
  const summary = record.summary;
  const document = record.document;
  const conclusion = record.kind === 'rating'
    ? summary?.ampacity ? `允许电流 ${fixed(summary.ampacity.value_a)} A（${summary.ampacity.basis_name}）` : '未算出允许电流'
    : record.title;
  const limiting = summary?.ampacity && document ? `受限于 ${cableName(summary.ampacity.limiting_cable, document)}` : '';
  const verification = summary?.verification;
  const parameters = (record.parameters ?? {}) as Record<string, any>;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>载流量计算书 · ${escape(record.project.name)} · #${record.sequence}</title><style>
    body{font:14px/1.65 "Segoe UI","Microsoft YaHei UI","PingFang SC",sans-serif;color:#111;margin:0;background:#fff}
    main{max-width:820px;margin:0 auto;padding:36px 28px 60px}
    h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:34px 0 10px;padding-bottom:6px;border-bottom:1px solid #c9ccd1}
    h3{font-size:16px;margin:22px 0 8px}h4{font-size:14px;margin:14px 0 6px;color:#333}
    table{border-collapse:collapse;width:100%;margin:6px 0 12px}th,td{border:1px solid #d5d8dd;padding:5px 9px;text-align:left;vertical-align:top}
    th{background:#f3f4f6;font-weight:600}td.n{text-align:right;font-variant-numeric:tabular-nums}
    dl{display:grid;grid-template-columns:1fr 1fr;gap:4px 28px;margin:6px 0 12px}dl div{display:flex;gap:10px;border-bottom:1px solid #eceef1;padding:4px 0}
    dt{color:#444;min-width:128px}dd{margin:0;font-weight:500;overflow-wrap:anywhere}
    .lead{font-size:20px;font-weight:600;margin:6px 0}.tier{display:inline-block;padding:2px 12px;border-radius:999px;border:1px solid #111;font-weight:600;margin-right:10px}
    .tier.reference{border-color:#9a6700;color:#7a5200;background:#fff8e6}.tier.deliverable{border-color:#1a7f37;color:#116329;background:#eefbf0}
    .note{background:#f6f7f9;border-left:3px solid #6b7280;padding:8px 12px;margin:10px 0}figure{margin:12px 0}figcaption{color:#333}
    ul{margin:6px 0 12px;padding-left:22px}svg{max-width:100%;height:auto}.mono{font-family:Consolas,monospace;font-size:13px;overflow-wrap:anywhere}
    @media print{main{padding:0;max-width:none}h2{break-after:avoid}table,figure{break-inside:avoid}}
  </style></head><body><main>
  <h1>载流量计算书</h1>
  ${pairs([['工程', record.project.name], ['记录', `#${record.sequence} · ${record.id}`], ['类型', KIND_NAMES[record.kind]], ['生成时间', record.created.replace('T', ' ').slice(0, 19) + ' UTC'],
    ['发起', record.by === 'agent' ? 'Agent（经同一套操作）' : '工程师']])}
  <h2>结论</h2>
  <p class="lead">${escape(conclusion)}${limiting ? `，${escape(limiting)}` : ''}</p>
  ${card ? `<p><span class="tier ${card.tier.tier}">${escape(card.tier.label)}</span>${escape(card.tier.meaning)}</p>${list(card.tier.basis)}` : ''}
  <div class="note">型号数据：${escape(STATE_NAMES[cable.state] ?? cable.state)}。${cable.state === 'demo' ? '结构尺寸与物性含明示假设，不是厂家确认的产品数据；' : '尺寸取自公开厂家资料，未经厂家签章确认；'}交付前须由工程师核对出处。</div>
  <h2>输入</h2>
  <h3>型号</h3>
  ${pairs([['型号', cable.name], ['库版本', cable.version], ['额定电压 U0/U', `${compact(cable.summary.u0_v / 1000)} / ${compact((cable.summary.u_v ?? 0) / 1000)} kV`],
    ['导体截面', `${cable.summary.cores > 1 ? cable.summary.cores + '×' : ''}${compact(cable.summary.area_mm2)} mm²`],
    ['导体 20 °C 直流电阻', cable.summary.r20_ohm_m ? `${compact(cable.summary.r20_ohm_m * 1000, 5)} Ω/km` : undefined],
    ['导体温限', `${compact(cable.payload.cable_type.rating.max_conductor_temperature.normal - 273.15)} °C`],
    ['电缆外径', `${compact(cable.summary.outer_diameter_m * 1000, 5)} mm`], ['内容摘要', cable.content_sha256.slice(0, 16)]])}
  ${cableTable(record)}
  <p><strong>数据出处：</strong>${escape(cable.source)}</p>
  <h3>敷设</h3>
  ${pairs([['敷设方式', document?.sections[0].label ?? installation.layout], ['中心埋深', `${compact(installation.depth_m)} m`],
    ['中心距', document?.sections[0].layout_template?.spacing ? `${compact(document.sections[0].layout_template.spacing * 1000, 5)} mm` : undefined],
    ['护套接地', BONDING_NAMES[installation.bonding]], ['回路数', document?.circuits.length],
    ['管内径 / 外径', installation.duct ? `${compact(installation.duct.inner_diameter_m * 1000)} / ${compact(installation.duct.outer_diameter_m * 1000)} mm` : undefined],
    ['管材热阻率', installation.duct ? `${compact(installation.duct.thermal_resistivity ?? 6)} K·m/W` : undefined]])}
  ${document && record.kind !== 'rating' ? `<figure>${sectionSvg(document)}<figcaption>敷设截面</figcaption></figure>` : ''}
  <h3>工况</h3>
  ${pairs([['土壤热阻率', `${compact(conditions.soil_thermal_resistivity)} K·m/W`], ['环境（地表）温度', `${compact(conditions.ambient_temperature_c)} °C`],
    ['负荷电流', conditions.currents_a.map(value => compact(value) + ' A').join(' / ')], ['频率', `${compact(conditions.frequency_hz)} Hz`],
    ['系统线电压', conditions.system_voltage_v ? `${compact(conditions.system_voltage_v / 1000)} kV` : undefined]])}
  <h3>方法参数</h3>
  ${pairs([['集肤效应系数 ks', parameters.ks], ['邻近效应系数 kp', parameters.kp], ['护套涡流损耗', EDDY_NAMES[parameters.eddy] ?? parameters.eddy],
    ['外部热阻公式', parameters.t4_form === 'exact' ? '精确式' : parameters.t4_form], ['计算依据', parameters.reference_basis ?? 'iec2023'],
    ['额定口径', parameters.rating_mode], ['电流迭代容差', parameters.solver ? `${parameters.solver.current_tolerance_a} A` : undefined],
    ['工程师改动的参数', Object.keys(method.parameters).length ? JSON.stringify(method.parameters) : '无，全部为库内声明的默认值']])}
  ${results(record)}
  ${verification ? `<h2>核对</h2><p>${escape(verification.basis)}</p>${table(['对象', '核对项', '计算值', '核对值', '差值', '容差', '单位', '结论'], verification.rows.map(row => [
    document ? cableName(row.entity, document) : row.entity, row.item, compact(row.computed, 8), compact(row.reference, 8), row.difference.toExponential(2),
    String(row.tolerance), row.unit, row.passed ? '通过' : '未通过']), [2, 3, 4, 5])}` : ''}
  ${card ? `<h2>方法卡</h2>${pairs([['方法', card.method], ['方法族', card.family], ['插件', card.plugin], ['方法版本', card.method_version], ['验证等级', card.validation.level]])}
  <p>${escape(card.summary)}</p><h3>依据标准</h3>${list(card.standards)}<h3>本敷设形式的验证依据</h3>${list(card.validation.this_configuration)}
  <h3>方法的全部验证算例</h3>${list(card.validation.cases)}<h3>假设与取舍</h3>${list(card.assumptions)}<h3>适用范围与限制</h3>${list(card.scope)}` : ''}
  ${summary?.warnings?.length ? `<h3>运行提示</h3>${list(summary.warnings.map(warning => warning.message))}` : ''}
  <h2>追溯</h2>
  <dl class="mono">${[['插件', `${record.plugin_id} ${record.plugin_version}`], ['能力 / 方法版本', `${record.capability} / ${record.method_version}`],
    ['清单摘要 sha256', record.manifest_sha256], ['请求摘要 sha256', record.request_sha256], ['输入摘要 sha256', record.inputs_sha256],
    ['核心运行标识', record.core_run_id], ['工况数', record.request.cases.length], ['Python', record.environment.python]].map(([label, value]) =>
    `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
  <p>本计算书由运行记录生成，记录写入后不可改；同一输入重新运行会得到新的记录。</p>
  </main></body></html>`;
}

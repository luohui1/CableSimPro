// GB 50217 correction of a rating the project already holds. The baseline is a saved run of the project: one three-core
// cable, alone, at the base conditions of Annex D. The actual conditions are the project's present inputs. The sealed
// `cablesim.gb50217-correction` method turns the first into the second with coefficients it reads from the standard
// basis, each with its page. A correction is written once and never changed, like a run record.
//
// Whether the baseline stands for what it claims is a person's to say: the method records that an engineer checked it.
// The software checks what it can (the same cable, a single circuit, the base ambient) and lists it; it does not
// confirm for anyone, and an agent cannot.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bool, obj, opt, str } from '@earendil-works/pi-schema';
import { BONDING_NAMES } from '../shared/format.ts';
import type { CorrectionBaseline, CorrectionCheck, CorrectionCoefficient, CorrectionPending, Gb50217Correction } from '../shared/model-types.ts';
import type { MethodCard, Parts, RunRecord } from '../shared/types.ts';
import { StudioError } from './core.ts';
import type { Context, Operation, Studio } from './operations.ts';
import { digest, inputsDigest } from './store.ts';

const ID = /^corr-[0-9a-f]{8}$/;
/** The method compares inputs with a tolerance of this size; so does the list of what the software checked. */
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

interface CoreCorrection {
  plugin_id: string; plugin_version: string; capability: string; method_version: string; manifest_sha256: string; request_sha256: string; core_run_id: string;
  request: Gb50217Correction['request'];
  result: Gb50217Correction['result'];
  correction: {
    coefficients: { label: string; condition_text: string; factor: number; formula_inputs?: Record<string, number>;
      record: { standard: string; edition: string; clause: string; printed_page: number | null; pdf_page: number | null; source_sha256: string } }[];
    total_factor: number; corrected_current_a: number; clauses: string[]; scope: string; headline: string;
  };
  method_card: MethodCard;
}

export function correctionOperations(studio: Studio): Operation[] {
  const { core, store } = studio;
  const project = str({ description: '工程标识，例如 p-1a2b3c4d' });
  const folder = (id: string): string => {
    store.meta(id);  // refuses a project that is not there
    return join(studio.home, 'projects', id, 'corrections');
  };
  const read = (id: string, correction: string): Gb50217Correction => {
    const path = join(folder(id), `${correction}.json`);
    if (!ID.test(correction) || !existsSync(path)) throw new StudioError({ code: 'CORRECTION_UNKNOWN', message: '没有这条校正记录。' }, 404);
    return JSON.parse(readFileSync(path, 'utf8')) as Gb50217Correction;
  };

  /** What the software can verify about a baseline; the rest is the engineer's to confirm. */
  const checksOf = (record: RunRecord, actual: Parts): CorrectionCheck[] => {
    const base = record.inputs;
    const ampacity = record.summary?.ampacity;
    return [
      { item: '基准是一条已算出允许电流的载流量校核', passed: record.kind === 'rating' && record.status === 'succeeded' && !!ampacity, detail: record.title },
      { item: '与当前工程是同一款型号、同一库版本', passed: base.cable.id === actual.cable.id && base.cable.content_sha256 === actual.cable.content_sha256,
        detail: `基准 ${base.cable.name}；当前 ${actual.cable.name}` },
      { item: '单根电缆：基准是单回路的允许电流', passed: ampacity?.basis === 'single_circuit', detail: ampacity?.basis_name ?? '没有允许电流' },
      { item: '基准环境温度是直埋的基准 25 °C', passed: near(base.conditions.ambient_temperature_c, 25), detail: `${base.conditions.ambient_temperature_c} °C` },
      { item: '基准与当前的中心埋深相同', passed: near(base.installation.depth_m, actual.installation.depth_m),
        detail: `基准 ${base.installation.depth_m} m；当前 ${actual.installation.depth_m} m` },
      { item: '基准与当前的土壤热阻率相同', passed: near(base.conditions.soil_thermal_resistivity, actual.conditions.soil_thermal_resistivity),
        detail: `基准 ${base.conditions.soil_thermal_resistivity} K·m/W；当前 ${actual.conditions.soil_thermal_resistivity} K·m/W` },
      { item: '基准与当前的系统电压相同', passed: (base.conditions.system_voltage_v ?? null) === (actual.conditions.system_voltage_v ?? null),
        detail: `基准 ${base.conditions.system_voltage_v ?? '未填'} V；当前 ${actual.conditions.system_voltage_v ?? '未填'} V` },
      { item: '基准与当前的频率相同', passed: near(base.conditions.frequency_hz, actual.conditions.frequency_hz),
        detail: `基准 ${base.conditions.frequency_hz} Hz；当前 ${actual.conditions.frequency_hz} Hz` },
      { item: '基准与当前的护套接地方式相同', passed: base.installation.bonding === actual.installation.bonding,
        detail: `基准 ${BONDING_NAMES[base.installation.bonding]}；当前 ${BONDING_NAMES[actual.installation.bonding]}` },
    ];
  };

  const header = (item: Gb50217Correction) => ({ id: item.id, created: item.created, by: item.by, baseline_run: item.baseline.run, baseline_ampacity_a: item.baseline.ampacity_a,
    total_factor: item.total_factor, corrected_current_a: item.corrected_current_a, headline: item.headline });

  return [
    { id: 'correction.gb50217', tool: 'correct_ampacity_gb50217', title: '按 GB 50217 校正载流量', kind: 'run',
      description: '把一条基准运行记录的允许电流，按本工程当前的环境温度、并列敷设（三芯电缆、同深度等间距），按 GB 50217—2018 附录 D 校正：给出各项校正系数（带条款和页码）、总系数和校正后的允许电流。'
        + '基准须是本工程里单回路、环境 25 °C，且与当前同埋深、同土壤热阻率、同系统电压、同频率、同护套接地方式的一条载流量校核。适用范围：10 kV 及以下；表外条件拒绝，不插值。分档为“参考”。'
        + '基准条件是否成立由工程师确认：不传 baseline_confirmed 或传 false 时只返回核对项，不给数；确认只能由人做，Agent 不能代为确认。',
      parameters: obj({
        project,
        baseline_run: str({ description: '基准运行记录标识，例如 run-1a2b3c4d：本工程里在基准条件下做的一条载流量校核（run_rating）' }),
        baseline_confirmed: opt(bool({ description: '工程师已核对基准条件（单根电缆、同型号、同正常导体温限、同中心埋深、没有按并列修正过）。只有人能确认' })),
      }),
      execute: async (params: { project: string; baseline_run: string; baseline_confirmed?: boolean }, context: Context): Promise<Gb50217Correction | CorrectionPending> => {
        const meta = store.meta(params.project);
        const actual = store.parts(params.project);
        const record = store.run(params.project, params.baseline_run);
        const ampacity = record.summary?.ampacity;
        if (record.kind !== 'rating' || !ampacity) {
          throw new StudioError({ code: 'BASELINE_INVALID', message: '这条运行记录不是一条已算出允许电流的载流量校核，不能作基准。', path: '/baseline_run' });
        }
        const checks = checksOf(record, actual);
        const baseline: CorrectionBaseline = {
          run: record.id, sequence: record.sequence, ampacity_a: ampacity.value_a, ambient_c: record.inputs.conditions.ambient_temperature_c,
          depth_m: record.inputs.installation.depth_m, soil_thermal_resistivity: record.inputs.conditions.soil_thermal_resistivity, record_digest: digest(record),
          source: `Cable Studio 运行记录 ${params.project}/${record.id}（第 ${record.sequence} 条）：${record.title}；${record.plugin_id} ${record.plugin_version}；`
            + `型号 ${record.inputs.cable.name} 库版本 ${record.inputs.cable.version}`,
        };
        const failed = checks.filter(item => !item.passed);
        if (params.baseline_confirmed !== true) {
          return { needs_confirmation: true, baseline, checks, message: failed.length
            ? `基准条件有 ${failed.length} 项不符，不能校正：${failed.map(item => item.item).join('；')}。`
            : '软件能核对的项都已满足。请工程师确认：基准取自这条运行记录，是单根电缆、同型号、同正常导体温限、同中心埋深的结果，且没有按并列分组修正过；'
              + '确认后再带 baseline_confirmed 为 true 执行，才会给出校正后的数。' };
        }
        if (context.by === 'agent') {
          throw new StudioError({ code: 'REVIEW_FORBIDDEN', message: '基准条件的确认只能由人来做。请把核对项交给工程师，由工程师在工作台里确认后执行。' }, 403);
        }
        if (failed.length) {
          throw new StudioError({ code: 'BASELINE_INVALID', message: `基准条件有 ${failed.length} 项不符，不能校正：${failed.map(item => `${item.item}（${item.detail}）`).join('；')}。`, path: '/baseline_run' });
        }
        const done = await core.call<CoreCorrection>('correction.gb50217', { scene: studio.scene(meta.name, actual), baseline: {
          current_a: baseline.ampacity_a, ambient_c: baseline.ambient_c, soil_thermal_resistivity: baseline.soil_thermal_resistivity, depth_m: baseline.depth_m,
          source: baseline.source, sha256: baseline.record_digest, page: 1, confirmed: true } });
        const found = done.correction;
        const saved: Gb50217Correction = {
          schema: 'cablesim.studio.correction/1', id: 'corr-' + randomBytes(4).toString('hex'), created: new Date().toISOString(), by: context.by,
          project: { id: meta.id, name: meta.name }, baseline, inputs_sha256: inputsDigest(actual), checks, confirmed_by: studio.user,
          coefficients: found.coefficients.map((item): CorrectionCoefficient => ({ label: item.label, condition: item.condition_text, factor: item.factor,
            standard: `${item.record.standard}—${item.record.edition}`, clause: item.record.clause, printed_page: item.record.printed_page, pdf_page: item.record.pdf_page,
            source_sha256: item.record.source_sha256, ...(item.formula_inputs ? { formula_inputs: item.formula_inputs } : {}) })),
          total_factor: found.total_factor, corrected_current_a: found.corrected_current_a, clauses: found.clauses, scope: found.scope, headline: found.headline,
          plugin_id: done.plugin_id, plugin_version: done.plugin_version, capability: done.capability, method_version: done.method_version,
          manifest_sha256: done.manifest_sha256, request_sha256: done.request_sha256, core_run_id: done.core_run_id, request: done.request, result: done.result,
          method_card: done.method_card,
        };
        // Written whole or not at all: a half-written file would make the project's whole list unreadable.
        mkdirSync(folder(params.project), { recursive: true });
        const path = join(folder(params.project), `${saved.id}.json`);
        const staging = `${path}.${randomBytes(4).toString('hex')}.part`;
        writeFileSync(staging, JSON.stringify(saved, null, 2) + '\n', 'utf8');
        renameSync(staging, path);
        studio.emit({ type: 'project', project_id: params.project });
        return saved;
      },
      brief: (result: Gb50217Correction | CorrectionPending) => 'needs_confirmation' in result
        ? { needs_confirmation: true, baseline: { run: result.baseline.run, ampacity_a: result.baseline.ampacity_a }, checks: result.checks.map(item => `${item.passed ? '✓' : '✗'} ${item.item}：${item.detail}`),
            message: result.message }
        : { correction: result.id, baseline_a: result.baseline.ampacity_a, baseline_run: result.baseline.run, total_factor: result.total_factor,
            corrected_current_a: result.corrected_current_a,
            coefficients: result.coefficients.map(item => `${item.label} ${item.factor}：${item.standard} ${item.clause}，第 ${item.printed_page} 页（${item.condition}）`),
            tier: result.method_card.tier.label, tier_basis: result.method_card.tier.basis, scope: result.scope, headline: result.headline } },

    { id: 'correction.list', tool: 'list_corrections', title: '校正记录', kind: 'read', parameters: obj({ project }),
      description: '列出本工程做过的 GB 50217 校正：基准运行记录、总系数和校正后的允许电流。',
      execute: async (params: { project: string }) => {
        const root = folder(params.project);
        if (!existsSync(root)) return [];
        return readdirSync(root).filter(name => ID.test(name.replace(/\.json$/, ''))).map(name => header(read(params.project, name.replace(/\.json$/, ''))))
          .sort((a, b) => b.created.localeCompare(a.created));
      } },

    { id: 'correction.get', tool: 'get_correction', title: '读取校正记录', kind: 'read', parameters: obj({ project, correction: str({ description: '校正记录标识，例如 corr-1a2b3c4d' }) }),
      description: '读取一条 GB 50217 校正记录：基准、各项系数（带条款和页码）、总系数、校正后的允许电流、方法卡。',
      execute: async (params: { project: string; correction: string }) => read(params.project, params.correction),
      brief: (item: Gb50217Correction) => ({ ...header(item), coefficients: item.coefficients.map(coefficient => `${coefficient.label} ${coefficient.factor}：${coefficient.standard} ${coefficient.clause}，第 ${coefficient.printed_page} 页`),
        tier: item.method_card.tier.label, scope: item.scope }) },
  ];
}

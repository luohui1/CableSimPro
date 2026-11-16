// Making a model by hand: a new series, and a specification typed in layer by layer. A typed specification goes
// through the same builder and the same checks as a row of an imported table and ends up the same kind of
// object: version 1, a draft, with its source recorded as typed in, by whom and when.
import { arr, bool, map, num, obj, oneOf, opt, str, union } from '@earendil-works/pi-schema';
import type { BuildResult, DesignationParts, GivenParameter, SeriesDeclaration } from '../shared/types.ts';
import type { ManualDerivation, SeriesCreated, SpecCreated } from '../shared/model-types.ts';
import { StudioError } from './core.ts';
import type { Context, Operation, Studio } from './operations.ts';

const given = obj({ value: union([num(), str()]), unit: str(), reference: str({ minLength: 1, maxLength: 2000 }) });
// An agent's tool call always carries the project it works in; these operations do not use it.
export const anyProject = { project: opt(str({ description: '工程标识；Agent 调用时自动带入，这个操作用不到' })) };

/** The structure table's fields as the builder reads them; the builder is the authority, this is the help text. */
const FIELD_NOTES = 'area 标称截面 mm²；conductor_diameter 导体外径 mm；conductor_wire_count 导体单线根数；conductor_wire_diameter 导体单线直径 mm；'
  + 'r20 20 °C 导体直流电阻 Ω/km（不填则按 GB/T 3956—2008 表 2 查，查不到就拒绝）；conductor_screen_thickness 导体屏蔽厚度 mm；'
  + 'insulation_thickness 绝缘标称厚度 mm；insulation_screen_thickness 绝缘屏蔽厚度 mm；screen_tape_thickness 铜带厚度 mm；screen_tape_width 铜带宽度 mm；'
  + 'screen_tape_overlap 铜带标称搭盖率 %；binder_thickness 包带厚度 mm；bedding_thickness 内衬层厚度 mm；armour_tape_thickness 钢带厚度 mm；'
  + 'armour_tape_width 钢带宽度 mm；armour_wire_diameter 钢丝直径 mm；armour_wire_count 钢丝根数；oversheath_thickness 外护套标称厚度 mm；'
  + 'outer_diameter 电缆近似外径 mm；weight 电缆近似重量 kg/km';

export function manualOperations(studio: Studio): Operation[] {
  const { core, library } = studio;
  const actor = (context: Context): string => (context.by === 'agent' ? 'Agent' : studio.user);
  /** What the version says about how its structure came in. An agent's entry waits for an engineer's check. */
  const entered = (context: Context): string => (context.by === 'agent' ? 'Agent 填写（待工程师核对）' : '人工填写');

  return [
    { id: 'library.series.create', tool: 'create_series', title: '新建系列', kind: 'write',
      description: '新建一个空的产品系列：型号写法、芯数、额定电压、执行标准，以及这个系列统一取的尺寸和计算用参数。规格之后用 create_spec 一个个加。'
        + '来源记为人工填写，并记下填写人和时间。未给出的计算用参数不会替你补；reference_modelling 为 true 时采用公开系列声明的参考值（每项带出处）。',
      parameters: obj({
        name: str({ minLength: 1, maxLength: 80, description: '系列名称，库里不能重名' }),
        designation: str({ minLength: 1, maxLength: 40, description: '型号写法，例如 YJV22' }),
        cores: oneOf([1, 3], { description: '芯数：1 或 3' }),
        u0_v: num({ exclusiveMinimum: 0, description: '额定电压 U0，V，例如 8700' }),
        u_v: num({ exclusiveMinimum: 0, description: '额定电压 U，V，例如 15000' }),
        um_v: opt(num({ exclusiveMinimum: 0, description: '系统最高电压 Um，V' })),
        manufacturer: opt(str({ maxLength: 80 })),
        standards: opt(arr(str({ minLength: 1, maxLength: 60 }), { maxItems: 12, description: '执行标准，写到年号，例如 GB/T 12706.2-2020；标准核对只判定这里写明的版本' })),
        origin: opt(oneOf(['factory', 'public'], { description: 'factory 本厂数据（缺省）；public 照公开厂家资料填写' })),
        armour_material: opt(oneOf(['steel_galvanized', 'steel_stainless_nonmagnetic'])),
        common: opt(map(num({ exclusiveMinimum: 0 }), { description: '全系列统一取的尺寸，字段同 create_spec 的 values，单位同结构表' })),
        common_basis: opt(map(str({ maxLength: 400 }), { description: 'common 里每一项的依据' })),
        modelling: opt(map(given, { description: '载流量方法需要而结构表没有的计算用参数，每项写明数值、单位和依据' })),
        reference_modelling: opt(bool({ description: '为 true 时，没有在 modelling 里写的参数采用公开系列声明的参考值（每项带出处）' })),
        outer_diameter_precision_mm: opt(num({ exclusiveMinimum: 0, description: '电缆外径填写的精度，mm，缺省 0.1；半个末位用于外径闭合的容差' })),
        ...anyProject,
      }),
      execute: async (params: Omit<SeriesDeclaration, 'cores' | 'standards' | 'common' | 'common_basis' | 'modelling' | 'manufacturer'> & {
        cores: 1 | 3; standards?: string[]; common?: Record<string, number>; common_basis?: Record<string, string>; manufacturer?: string;
        modelling?: Record<string, GivenParameter>; reference_modelling?: boolean; outer_diameter_precision_mm?: number }, context): Promise<SeriesCreated> => {
        const by = actor(context);
        const at = new Date().toISOString();
        const reference = params.reference_modelling
          ? (await core.call<{ reference_modelling: Record<string, GivenParameter> }>('structure.vocabulary')).reference_modelling : {};
        const modelling: Record<string, GivenParameter> = { ...reference, ...(params.modelling ?? {}) };
        // The precision the engineer states wins over a reference value, but not over a rounding the declaration itself gives.
        if (!('diameter_rounding' in (params.modelling ?? {})) && (params.outer_diameter_precision_mm !== undefined || !('diameter_rounding' in modelling))) {
          const precision = params.outer_diameter_precision_mm ?? 0.1;
          modelling.diameter_rounding = { value: precision / 2000, unit: 'm',
            reference: `人工填写：电缆外径按 ${precision} mm 的精度填写，半个末位 ${precision / 2} mm；闭合容差另加 max(0.5 mm, 外径 1%)。` };
        }
        const declaration: SeriesDeclaration = {
          name: params.name.trim(), manufacturer: params.manufacturer ?? '', designation: params.designation.trim(), cores: params.cores,
          u0_v: params.u0_v, u_v: params.u_v, ...(params.um_v ? { um_v: params.um_v } : {}), standards: params.standards ?? [],
          common: params.common ?? {}, common_basis: params.common_basis ?? {}, modelling, origin: params.origin ?? 'factory',
          ...(params.armour_material ? { armour_material: params.armour_material } : {}),
          source: { title: '人工填写', location: `Cable Studio 型号库 · ${by} · ${at}` },
        };
        const checked = await core.call<{ designation: DesignationParts }>('structure.declare', { series: declaration });
        const series = library.openSeries(declaration, checked.designation.description, by);
        studio.emit({ type: 'library', series_id: series });
        return { series, name: declaration.name, description: checked.designation.description, declaration };
      },
      brief: (result: SeriesCreated) => ({ series: result.series, name: result.name, description: result.description,
        standards: result.declaration.standards, next: '用 create_spec 往这个系列里加规格' }) },

    { id: 'library.spec.create', tool: 'create_spec', title: '新建规格', kind: 'write',
      description: '在系列里新建一个规格：结构按层逐项填写，字段和单位与导入结构表相同，尺寸校验和外径闭合也与导入时完全一样；表里没有的尺寸取系列声明。'
        + '结果是第 1 版草稿，来源记为人工填写，并记下填写人和时间；审核仍由人来做。字段：' + FIELD_NOTES + '。',
      parameters: obj({
        series: str({ description: '系列标识，例如 s-1a2b3c4d' }),
        values: map(num({ exclusiveMinimum: 0 }), { description: '字段 → 数值，单位见字段说明；area 是规格身份，必填' }),
        basis: opt(map(str({ maxLength: 400 }), { description: '字段 → 这个数值的依据（标准条款、图纸号等），随数值保存' })),
        ...anyProject,
      }),
      execute: async (params: { series: string; values: Record<string, number>; basis?: Record<string, string> }, context): Promise<SpecCreated> => {
        const declaration = library.declaration(params.series);
        const known = new Set((await core.call<{ fields: { key: string }[] }>('structure.vocabulary')).fields.map(field => field.key));
        const unknown = Object.keys(params.values).find(key => !known.has(key));
        if (unknown) throw new StudioError({ code: 'INPUT_INVALID', message: `“${unknown}”不是结构表字段，字段见这个操作的说明。`, path: `/values/${unknown}` });
        const stray = Object.keys(params.basis ?? {}).find(key => !(key in params.values));
        if (stray) throw new StudioError({ code: 'INPUT_INVALID', message: `依据里的“${stray}”没有对应的数值。`, path: `/basis/${stray}` });
        const by = actor(context);
        const at = new Date().toISOString();
        const how = entered(context);
        const bases = Object.fromEntries(Object.keys(params.values).map(key => [key, params.basis?.[key] ? `${how}；${params.basis[key]}` : how]));
        // The row is typed in whatever the series' own source says: what the builder writes into the entry's source is this.
        const typed: SeriesDeclaration = { ...declaration, source: { title: how, location: `Cable Studio 型号库 · ${by} · ${at}；所在系列：${declaration.name}` } };
        const built = await core.call<BuildResult>('structure.build', { series: typed, rows: [params.values], bases: [bases] });
        const row = built.rows[0];
        if (!row.ok) throw new StudioError(row.error);
        const derivation: ManualDerivation = { ...row.derivation, entry: 'manual', entered_by: by, entered_at: at };
        const spec = library.addSpec(params.series, { ...row, derivation }, how, by);
        studio.emit({ type: 'library', series_id: params.series });
        return { spec, version: 1, view: library.specView(spec) };
      },
      brief: (result: SpecCreated) => ({ spec: result.spec, name: result.view.spec.name, version: result.version, review: result.view.version.review,
        source: result.view.version.note, entered_by: result.view.version.created_by, entered_at: result.view.version.created,
        outer_diameter_mm: result.view.entry.summary.outer_diameter_m * 1000, closure: result.view.closure,
        warnings: result.view.warnings.map(warning => warning.message),
        structure: result.view.structure.map(item => `${item.label} ${item.value} ${item.unit}`),
        next: '用 compute_series 计算并核对（specs 里填这个规格）；审核由人来做' }) },
  ];
}

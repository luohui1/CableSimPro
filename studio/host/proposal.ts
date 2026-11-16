// The initial structure a product standard gives: the standard, the voltage, the cores, the conductor, the insulation
// and the armour in; the dimensions out, each with the standard, the clause and the pages it comes from. The work is
// done by the sealed `cablesim.standard-check` method through the core; nothing here knows a thickness or a table.
import { bool, num, obj, oneOf, opt, str } from '@earendil-works/pi-schema';
import type { StructureProposal } from '../shared/model-types.ts';
import type { Operation, Studio } from './operations.ts';

export function proposalOperations(studio: Studio): Operation[] {
  const { core } = studio;
  return [
    { id: 'structure.propose', tool: 'propose_structure', title: '按标准生成初始结构', kind: 'read',
      description: '按执行标准、电压等级、芯数、导体材料和截面、绝缘材料、铠装形式，给出一份初始结构：每个尺寸带标准号、表或条款、印刷页和 PDF 页。'
        + '只给标准规定或按附录算出的厚度，不给近似值；只给绝缘厚度时（scope 为 insulation）其余尺寸列在 missing 里。要连内衬、铠装、外护套一起算（scope 为 complete），'
        + '须给 screened 和屏蔽层厚度，它们由工程师定。结果里的 values 和 basis 可以直接交给 create_spec，补上 missing 里的导体外径、成品外径等就能建成规格。'
        + '执行标准与电压等级对不上、表外电压或截面都会拒绝。',
      parameters: obj({
        standard: str({ minLength: 1, maxLength: 60, description: '执行标准，写到年号，例如 GB/T 12706.2-2020；必须与电压等级对应的标准一致' }),
        u0_v: num({ exclusiveMinimum: 0, description: '额定电压 U0，V，例如 8700' }),
        u_v: num({ exclusiveMinimum: 0, description: '额定电压 U，V，例如 15000' }),
        cores: oneOf([1, 3], { description: '芯数：1 或 3' }),
        conductor: oneOf(['copper', 'aluminium'], { description: '导体材料：copper 铜，aluminium 铝' }),
        area_mm2: num({ exclusiveMinimum: 0, maximum: 2500, description: '导体标称截面，mm²' }),
        insulation: oneOf(['XLPE'], { description: '绝缘材料；目前只有 XLPE（交联聚乙烯）' }),
        armour: oneOf(['none', 'steel_tape'], { description: '铠装形式：none 无铠装，steel_tape 双钢带铠装（只用于三芯）' }),
        scope: opt(oneOf(['insulation', 'complete'], { description: 'insulation 只给绝缘厚度；complete 连内衬、铠装、外护套。缺省：给了 screened 就是 complete，否则 insulation' })),
        conductor_diameter_mm: opt(num({ exclusiveMinimum: 0, description: '导体外径，mm；不写则按同截面的实心圆，建规格时仍须填实际值' })),
        screened: opt(bool({ description: '有无半导电屏蔽（导体屏蔽与绝缘屏蔽）；scope 为 complete 时必填' })),
        conductor_screen_thickness_mm: opt(num({ exclusiveMinimum: 0, description: '导体屏蔽厚度，mm，由工程师给定；有屏蔽时必填' })),
        insulation_screen_thickness_mm: opt(num({ exclusiveMinimum: 0, description: '绝缘屏蔽厚度，mm，由工程师给定；有屏蔽时必填' })),
        screen_tape_thickness_mm: opt(num({ exclusiveMinimum: 0, description: '铜带屏蔽的单带厚度，mm；6 kV 及以上必填' })),
        screen_tape_width_mm: opt(num({ exclusiveMinimum: 0, description: '铜带宽度，mm；6 kV 及以上必填' })),
      }),
      execute: async (params: Record<string, unknown>): Promise<StructureProposal> => core.call<StructureProposal>('structure.propose', params),
      brief: (result: StructureProposal) => ({
        standard: result.standard, scope: result.scope, values: result.values, sources: result.basis,
        missing: result.missing.map(item => `${item.label}（${item.field}，${item.unit}）：${item.reason}`),
        limitations: result.limitations,
        next: '把 values 和 sources（作为 basis）连同 missing 里补齐的尺寸交给 create_spec，就建成一个草稿规格；之后用 compute_series 做标准核对',
      }) },
  ];
}

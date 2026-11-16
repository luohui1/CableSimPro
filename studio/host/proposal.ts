// The initial structure a product standard gives: the standard, the voltage, the cores, the conductor, the insulation
// and the armour in; the dimensions out, each with the standard, the clause and the pages it comes from. The work is
// done by the sealed `cablesim.standard-check` method through the core; nothing here knows a thickness or a table.
//
// A proposal is kept as it came, under an identity that follows from its inputs and answers, so a specification made
// from it can say which proposal, which method and which version its dimensions were taken from, and so a value
// cannot keep the standard's citation after someone changes the number.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bool, num, obj, oneOf, opt, str } from '@earendil-works/pi-schema';
import type { StructureProposal } from '../shared/model-types.ts';
import { StudioError } from './core.ts';
import type { Operation, Studio } from './operations.ts';
import { digest } from './store.ts';

const ID = /^prop-[0-9a-f]{12}$/;

/** Keep a proposal; one that is already kept is the same one. */
export function saveProposal(home: string, proposal: Omit<StructureProposal, 'id'>): StructureProposal {
  const id = 'prop-' + digest({ inputs: proposal.inputs, values: proposal.values, basis: proposal.basis, request: proposal.method.request_sha256 }).slice(0, 12);
  const kept: StructureProposal = { id, ...proposal };
  mkdirSync(join(home, 'proposals'), { recursive: true });
  writeFileSync(join(home, 'proposals', `${id}.json`), JSON.stringify(kept, null, 2) + '\n', { encoding: 'utf8', flag: 'w' });
  return kept;
}

export function loadProposal(home: string, id: string): StructureProposal {
  try {
    if (ID.test(id)) return JSON.parse(readFileSync(join(home, 'proposals', `${id}.json`), 'utf8')) as StructureProposal;
  } catch { /* falls through to the refusal */ }
  throw new StudioError({ code: 'PROPOSAL_UNKNOWN', message: '没有这份标准提案；请重新用 propose_structure 生成。', path: '/proposal' }, 404);
}

export function proposalOperations(studio: Studio): Operation[] {
  const { core } = studio;
  return [
    { id: 'structure.propose', tool: 'propose_structure', title: '按标准生成初始结构', kind: 'run',
      description: '按执行标准、电压等级、芯数、导体材料和截面、绝缘材料、铠装形式，给出一份初始结构：每个尺寸带标准号、表或条款、印刷页和 PDF 页，并保存成一份提案（返回提案标识）。'
        + '只给标准规定或按附录算出的厚度，不给近似值；只给绝缘厚度时（scope 为 insulation）其余尺寸列在 missing 里。要连内衬、铠装、外护套一起算（scope 为 complete），'
        + '须给 screened 和屏蔽层厚度，它们由工程师定。把提案标识连同补齐 missing 里的导体外径、成品外径等交给 create_spec，就建成一个草稿规格，依据和方法版本随版本保存。'
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
      execute: async (params: Record<string, unknown>): Promise<StructureProposal> =>
        saveProposal(studio.home, await core.call<Omit<StructureProposal, 'id'>>('structure.propose', params)),
      brief: (result: StructureProposal) => ({
        proposal: result.id, standard: result.standard, scope: result.scope, values: result.values, sources: result.basis,
        missing: result.missing.map(item => `${item.label}（${item.field}，${item.unit}）：${item.reason}`),
        limitations: result.limitations,
        next: '把 proposal 标识、values 里要用的尺寸和 missing 里补齐的尺寸交给 create_spec，就建成一个草稿规格；引用提案时提案里的数不能改；之后用 compute_series 做标准核对',
      }) },

    { id: 'structure.proposal', tool: 'get_proposal', title: '读取标准提案', kind: 'read',
      description: '读取一份保存的标准提案：每个尺寸的数值、标准号、表或条款、印刷页和 PDF 页、依据记录的摘要，以及生成它的插件和方法版本。',
      parameters: obj({ proposal: str({ description: '提案标识，例如 prop-1a2b3c4d5e6f' }) }),
      execute: async (params: { proposal: string }): Promise<StructureProposal> => loadProposal(studio.home, params.proposal),
      brief: (result: StructureProposal) => ({ proposal: result.id, standard: result.standard, scope: result.scope, inputs: result.inputs, values: result.values,
        sources: result.basis, method: result.method }) },
  ];
}

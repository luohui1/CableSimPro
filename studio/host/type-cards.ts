// What the model-type operations leave in the conversation: the references their result cards are drawn from and the facts for the
// step rows. The operations are the model-type work's; the cards are the conversation's, so they are attached here, in one place,
// and the operations' own files stay as they are.
import { compact, fixed } from '../shared/format.ts';
import type { Gb50217Correction, CorrectionPending, RatingTable, SeriesCreated, SpecCreated, StructureProposal } from '../shared/model-types.ts';
import type { CardRef } from '../shared/types.ts';
import type { Operation, Studio } from './operations.ts';

type Decoration = Pick<Operation, 'card' | 'notes'>;

export function attachTypeCards(studio: Studio): void {
  /** Where the workbench shows one version of one specification. */
  const specHref = (spec: string, version: number) => `/library/${studio.library.specView(spec, version).series.id}?spec=${encodeURIComponent(spec)}&version=${version}`;
  const decorate = (id: string, decoration: Decoration) => {
    const operation = studio.operations.get(id);
    if (operation) Object.assign(operation, decoration);
  };
  const proposalCard = (_params: unknown, proposal: StructureProposal): CardRef => ({ kind: 'standard', proposal: proposal.id });
  const correctionCard = (_params: unknown, result: Gb50217Correction | CorrectionPending): CardRef | undefined =>
    'needs_confirmation' in result ? undefined : { kind: 'correction', project: result.project.id, correction: result.id, href: `/p/${result.project.id}` };

  decorate('library.series.create', {
    card: (_params, created: SeriesCreated): CardRef => ({ kind: 'open', label: `系列 ${created.name}`, href: `/library/${created.series}` }),
    notes: (_params, created: SeriesCreated) => [`新系列 ${created.name}，还没有规格`],
  });
  decorate('library.spec.create', {
    card: (_params, created: SpecCreated): CardRef => ({ kind: 'open', label: `规格 ${created.view.spec.name} · 第 ${created.version} 版`, href: specHref(created.spec, created.version) }),
    notes: (_params, created: SpecCreated) => [`第 ${created.version} 版草稿，结构由 Agent 填写，待工程师核对`],
  });
  decorate('library.rating.table', {
    card: (_params, table: RatingTable): CardRef => ({ kind: 'rating_table', spec: table.spec, version: table.version, table: table.id, href: specHref(table.spec, table.version) }),
    notes: (_params, table: RatingTable) => {
      const refused = table.rows.filter(row => row.status !== 'succeeded').length;
      return [`${table.rows.length} 个条件，${table.rows.length - refused} 个算出${refused ? `，${refused} 个方法拒算` : ''}`];
    },
  });
  decorate('structure.propose', {
    card: proposalCard,
    notes: (_params, proposal: StructureProposal) => [`${proposal.standard}，${proposal.scope === 'complete' ? '内衬、铠装、外护套一并给出' : '只给绝缘厚度'}`,
      `${proposal.dimensions.length} 个尺寸带依据${proposal.missing.length ? `，还缺 ${proposal.missing.length} 项要工程师补` : ''}`],
  });
  decorate('structure.proposal', { card: proposalCard });
  decorate('correction.gb50217', {
    card: correctionCard,
    notes: (_params, result: Gb50217Correction | CorrectionPending) => ('needs_confirmation' in result
      ? [...result.checks.map(item => `${item.passed ? '符合' : '不符'}：${item.item}（${item.detail}）`), '基准条件要工程师确认，确认前不给数']
      : [`总系数 ${compact(result.total_factor)}，校正后允许电流 ${fixed(result.corrected_current_a)} A`]),
  });
  decorate('correction.get', { card: (params, result: Gb50217Correction) => correctionCard(params, result) });
}

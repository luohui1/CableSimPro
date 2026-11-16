// The type workspace's second-level screens: the library with sizes ticked for a batch, and the three dialogs of a version
// (修改结构, 审核, 规格书) over its structure page. Data: series s-89150e51 and its version 3 on this branch's host
// (library-data.ts, host-records.ts); the edit repeats what version 2 did (insulation 4.5 → 4 mm, its own note), the review
// is the approval version 3 received (its note).
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Icon } from '@/kit/icon';
import { Dot, VerdictBar } from '@/kit/marks';
import { FormNote, FormRow, UnitInput } from '@/kit/workbench/form';
import { SelectionBar } from '@/kit/workbench/page';
import { compact } from '@shared/format';
import { LIBRARY, WORKSPACE } from './library-data';
import { VERSIONS } from './host-records';
import { LibraryScreenBody, SeriesScreenBody, SeriesShell } from './workbench-screens';

// ---- 型号库 · 选了几个规格 ----

const TICKED = LIBRARY[0].specs.filter(spec => ['3×185', '3×240', '3×300'].includes(spec.key)).map(spec => spec.id);

export function LibraryBatchScreenBody() {
  const [ticked, setTicked] = useState(TICKED);
  return <LibraryScreenBody ticked={ticked} onTick={setTicked} toolbar={<SelectionBar count={ticked.length} unit="个规格" onClear={() => setTicked([])}>
    <Button variant="outline" size="sm"><Icon name="run/run" data-icon="inline-start" />计算与核对</Button>
    <Button variant="outline" size="sm"><Icon name="agent/approve" data-icon="inline-start" />提交审核</Button>
    <Button variant="outline" size="sm"><Icon name="action/check" data-icon="inline-start" />审核通过</Button>
    <Button variant="outline" size="sm"><Icon name="object/file" data-icon="inline-start" />规格书</Button>
  </SelectionBar>} />;
}

// ---- 修改结构 ----

const V3 = VERSIONS.find(version => version.number === 3)!;
const V2 = VERSIONS.find(version => version.number === 2)!;
// Only the dimensions the table gave can be changed; the size itself (the area) and the weight are not dimensions.
const EDITABLE = WORKSPACE.structure.filter(row => row.origin === 'table' && !['area', 'weight'].includes(row.key));
const EDITED: Record<string, number> = { insulation_thickness: 4 };

function EditDialog() {
  return <Dialog open>
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>修改结构</DialogTitle>
        <DialogDescription>{WORKSPACE.name} 第 {V3.number} 版。只能改原表给出的尺寸；保存后出第 {V3.number + 1} 版草稿，第 {V3.number} 版和它的结果都留着。</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-3">
        {EDITABLE.map(row => <FormRow key={row.key} label={row.label} htmlFor={`edit-${row.key}`} changed={row.key in EDITED}
          hint={row.key in EDITED ? `第 ${V3.number} 版是 ${compact(Number(row.value))} ${row.unit}` : undefined}>
          <UnitInput id={`edit-${row.key}`} unit={row.unit} defaultValue={EDITED[row.key] ?? Number(row.value)} />
        </FormRow>)}
        <FormRow label="修改原因" htmlFor="edit-note"><Textarea id="edit-note" defaultValue={V2.note} maxLength={400} /></FormRow>
      </div>
      <DialogFooter>
        <Badge variant="attention" className="mr-auto gap-2"><Dot tone="attention" />改了 {Object.keys(EDITED).length} 项</Badge>
        <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
        <Button><Icon name="action/save" data-icon="inline-start" />保存为第 {V3.number + 1} 版草稿</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export const SeriesEditScreenBody = () => <><SeriesScreenBody /><EditDialog /></>;

// ---- 审核 ----

// The note the approval of version 3 carried on the host.
const REVIEW_NOTE = 'reviewed' in V3 && V3.reviewed && 'note' in V3.reviewed ? V3.reviewed.note : '';

function ReviewDialog() {
  const [seen, setSeen] = useState(true);
  const check = V3.check as Record<string, number>;
  return <Dialog open>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>审核通过</DialogTitle>
        <DialogDescription>{WORKSPACE.name} 第 {V3.number} 版，现在待审核。审核只能由人来做，会记进这一版的留痕。</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-sm text-ink-2">这一版的标准核对</span>
          <VerdictBar counts={check} />
        </div>
        <FormNote tone="attention">还有 {check.missing} 项缺项、{check.uncovered} 项不在核对范围内：审核通过不表示这些项都满足。</FormNote>
        <label className="flex items-start gap-3 text-sm text-ink">
          <Checkbox className="mt-1" checked={seen} onCheckedChange={setSeen} />我看过缺项和不在范围内的项，确认这条审核意见。
        </label>
        <FormRow label="审核意见" htmlFor="review-note"><Textarea id="review-note" defaultValue={REVIEW_NOTE} maxLength={400} /></FormRow>
      </div>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
        <Button disabled={!seen}><Icon name="action/check" data-icon="inline-start" />确认审核通过</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export const SeriesReviewScreenBody = () => <><SeriesScreenBody review="submitted" /><ReviewDialog /></>;

// ---- 规格书 ----

// What the datasheet carries, as the host writes it (library.export): the structure, the parameters it computed with their
// clauses, the check with its open items, the rating tables kept on the version, and a snapshot of where each number came from.
const SHEET_PARTS = ['结构尺寸和每个数的出处', '电气参数和短路电流（附条款）', '标准核对：通过、不通过、缺项逐条列出', '这一版上的载流量表', '来源快照（另存一份 JSON）'];

function SheetDialog() {
  return <Dialog open>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>生成规格书</DialogTitle>
        <DialogDescription>按 {WORKSPACE.name} 第 {V3.number} 版（已审核）生成 PDF。文件如实写出缺项、计算条件和出处；没审核过的版本会在每页标“草稿”。</DialogDescription>
      </DialogHeader>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm text-ink">
        {SHEET_PARTS.map(part => <li key={part} className="flex items-center gap-2"><Icon name="action/check" className="text-ink-2" />{part}</li>)}
      </ul>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>取消</DialogClose>
        <Button><Icon name="object/file" data-icon="inline-start" />生成规格书 PDF</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export const SeriesSheetScreenBody = () => <><SeriesScreenBody /><SheetDialog /></>;

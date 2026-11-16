// The gallery section of the base controls added for the component sourcing (shadcn/ui on Base UI, cmdk, sonner, Base UI
// NumberField): each in use, with content from the data files.
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { NumberField, NumberFieldAddon, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from '@/components/ui/number-field';
import { Icon } from '@/kit/icon';
import { PROJECT_NAMES, PROPOSAL, RUN_INPUTS } from './host-records';
import { LIBRARY } from './library-data';
import { EXPORT_ANSWER, HOST_DOWN, REFUSED_RATING, SHEET } from './samples';
import { Specimen, State } from './sections';

const SPECS = LIBRARY[0].specs.map(spec => `${LIBRARY[0].designation}-${LIBRARY[0].u0_kv}/${LIBRARY[0].u_kv} kV ${spec.key}`);
const INSULATION = PROPOSAL.complete.dimensions.find(item => item.field === 'insulation_thickness')!;

export function SourcedControlsSection() {
  const [spec, setSpec] = useState<string | null>(SPECS[8]);
  return <>
    <Specimen title="命令面板" rule="cmdk（shadcn/ui command）：搜型号、工程和标准，回车跳转；Ctrl K 打开。" wide>
      <State label="打开时" className="w-full max-w-prose"><Command className="rounded-card border border-line">
        <CommandInput placeholder="搜型号、工程或标准" />
        <CommandList>
          <CommandEmpty>没有找到</CommandEmpty>
          <CommandGroup heading="型号">
            {SPECS.slice(7, 10).map(name => <CommandItem key={name}><Icon name="nav/cable-type" />{name}</CommandItem>)}
          </CommandGroup>
          <CommandGroup heading="工程">
            {PROJECT_NAMES.map(name => <CommandItem key={name}><Icon name="object/study" />{name}</CommandItem>)}
          </CommandGroup>
          <CommandGroup heading="标准">
            <CommandItem><Icon name="source/from-standard" />{INSULATION.basis}<CommandShortcut>Enter</CommandShortcut></CommandItem>
          </CommandGroup>
        </CommandList>
      </Command></State>
    </Specimen>
    <Specimen title="可搜索的下拉" rule="Base UI Combobox（shadcn/ui combobox）：在长清单里边打字边选，比如从一个系列里选规格。">
      <State label="选规格" className="w-80"><Combobox items={SPECS} value={spec} onValueChange={next => setSpec(next as string | null)}>
        <ComboboxInput placeholder="选一个规格" aria-label="规格" />
        <ComboboxContent>
          <ComboboxEmpty>没有这个规格</ComboboxEmpty>
          <ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList>
        </ComboboxContent>
      </Combobox></State>
    </Specimen>
    <Specimen title="数字输入" rule="Base UI NumberField：字段自己解析和格式化数字，右对齐等宽，不加千分位；需要时带加减。带单位的数（UnitInput）就建在它上面。">
      <State label="带加减（步长 0.1）" className="w-56"><NumberField defaultValue={RUN_INPUTS.installation.depth_m} step={0.1} min={0} aria-label="埋深">
        <NumberFieldGroup>
          <NumberFieldDecrement className="ml-1" />
          <NumberFieldInput />
          <NumberFieldAddon className="pr-1">m</NumberFieldAddon>
          <NumberFieldIncrement className="mr-1" />
        </NumberFieldGroup>
      </NumberField></State>
      <State label="大数不加千分位" className="w-56"><NumberField defaultValue={RUN_INPUTS.conditions.system_voltage_v} aria-label="系统电压">
        <NumberFieldGroup><NumberFieldInput /><NumberFieldAddon className="w-16 pr-3">V</NumberFieldAddon></NumberFieldGroup>
      </NumberField></State>
    </Specimen>
    <Specimen title="提示块" rule="shadcn/ui alert：出错和拒算的原话放在里面；拒算卡的内部就是它。">
      <State label="拒算" className="w-full max-w-prose"><Alert>
        <Icon name="status/warning" />
        <AlertTitle className="font-normal">{REFUSED_RATING.reason}</AlertTitle>
        <AlertDescription>{REFUSED_RATING.missing.map(item => `${item.label}：${item.detail}`).join('；')}</AlertDescription>
      </Alert></State>
      <State label="出错" className="w-full max-w-prose"><Alert variant="destructive">
        <Icon name="status/error" />
        <AlertTitle className="font-normal">{HOST_DOWN}</AlertTitle>
      </Alert></State>
    </Specimen>
    <Specimen title="确认破坏性操作" rule="Base UI AlertDialog（shadcn/ui alert-dialog）：说清会丢掉什么，默认按钮是取消。">
      <State label="退回修改"><AlertDialog>
        <AlertDialogTrigger render={<Button variant="outline" />}>退回修改</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>把第 3 版退回修改？</AlertDialogTitle>
            <AlertDialogDescription>退回后这一版回到草稿，提交审核和审核通过的记录会清空。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction>退回修改</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog></State>
    </Specimen>
    <Specimen title="轻提示" rule="sonner：做完一件事或出了错，在角上停几秒；内容是宿主的原话。">
      <State label="成功"><Button variant="outline" onClick={() => toast.success(SHEET.title, { description: EXPORT_ANSWER.split('。')[0] })}>导出规格书后</Button></State>
      <State label="出错"><Button variant="outline" onClick={() => toast.error(HOST_DOWN)}>连不上本机服务时</Button></State>
    </Specimen>
    <Specimen title="悬停卡与右键菜单" rule="Base UI PreviewCard（hover-card）给出处的原文；Base UI ContextMenu（context-menu）放一行上的操作。">
      <State label="出处的原文"><HoverCard>
        <HoverCardTrigger render={<Button variant="link" className="h-auto px-0" />}>{INSULATION.clause}</HoverCardTrigger>
        <HoverCardContent className="w-80 text-sm">
          <div className="flex flex-col gap-1">
            <span className="font-medium text-ink">{PROPOSAL.standard} {INSULATION.clause}</span>
            <span className="text-ink-2">{INSULATION.basis}</span>
            <span className="text-ink">{INSULATION.label} {INSULATION.value} {INSULATION.unit}</span>
          </div>
        </HoverCardContent>
      </HoverCard></State>
      <State label="一行上的操作"><ContextMenu>
        <ContextMenuTrigger className="flex h-16 w-72 items-center justify-center rounded-card border border-dashed border-line-strong text-sm text-ink-2">在这里点右键：{SPECS[8]}</ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem>打开<ContextMenuShortcut>Enter</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuItem>导出规格书</ContextMenuItem>
          <ContextMenuItem>复制规格名</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem>出新版本</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu></State>
    </Specimen>
    <Specimen title="快捷键" rule="shadcn/ui kbd：在按钮、菜单和提示里写出快捷键。">
      <State label="命令面板"><KbdGroup><Kbd>Ctrl</Kbd><Kbd>K</Kbd></KbdGroup></State>
      <State label="打开选中的规格"><Kbd>Enter</Kbd></State>
    </Specimen>
  </>;
}

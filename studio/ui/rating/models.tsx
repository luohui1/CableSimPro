// The cables of the product library as a table, a series to a group: where a rating project takes its cable from.
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Icon } from '@/kit/icon';
import { DataTable, type Column } from '@/kit/workbench/data-table';
import { Toolbar } from '@/kit/workbench/page';
import { EmptyState } from '@/kit/workbench/premise';
import { cn } from '@/lib/utils';
import { compact, STATE_NAMES } from '@shared/format';
import type { LibraryEntry } from '@shared/types';

const VOLTAGE = (entry: LibraryEntry) => `${compact(entry.summary.u0_v / 1000)}/${compact((entry.summary.u_v ?? 0) / 1000)}`;

// What choosing a cable needs: its name, size and rating, and where its data comes from. The names need the room.
const COLUMNS: Column<LibraryEntry>[] = [
  { key: 'name', header: '型号', cell: entry => <span className="font-medium">{entry.name}</span> },
  { key: 'size', header: '截面', unit: 'mm²', numeric: true, width: 'w-24', cell: entry => `${entry.summary.cores > 1 ? `${entry.summary.cores}×` : ''}${compact(entry.summary.area_mm2)}` },
  { key: 'voltage', header: '额定电压', unit: 'kV', width: 'w-32', cell: VOLTAGE },
  { key: 'origin', header: '来源', width: 'w-36', cell: entry => <Badge variant="outline">{STATE_NAMES[entry.state] ?? entry.state}</Badge> },
];

export function ModelTable({ entries, selected, onSelect, className }: {
  entries: LibraryEntry[];
  selected?: string;
  onSelect: (entry: LibraryEntry) => void;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const reached = useRef(false);
  const needle = query.trim().toLowerCase();
  const shown = needle ? entries.filter(entry => `${entry.name} ${entry.family}`.toLowerCase().includes(needle)) : entries;
  const families = [...new Set(shown.map(entry => entry.family))];
  // A cable that is already chosen when the table appears (it came with the address) is brought into view once.
  useEffect(() => {
    if (reached.current || !selected || !entries.length) return;
    const row = root.current?.querySelector('[data-state="selected"]');
    if (!row) return;
    reached.current = true;
    row.scrollIntoView({ block: 'center' });
  }, [entries.length, selected]);
  return <div ref={root} className={cn('flex min-h-0 flex-1 flex-col', className)}>
    <Toolbar>
      <InputGroup className="w-72">
        <InputGroupAddon><Icon name="action/search" /></InputGroupAddon>
        <InputGroupInput value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索型号或系列" aria-label="搜索型号库" />
      </InputGroup>
    </Toolbar>
    <DataTable className="flex-1" columns={COLUMNS} rowKey={entry => entry.id} selected={selected} onSelect={onSelect}
      empty={<EmptyState icon="action/search" title="没有符合的型号" description="换个关键词，或到型号库导入结构表。" />}
      groups={families.map(family => {
        const rows = shown.filter(entry => entry.family === family);
        return {
          key: family,
          header: <span className="font-medium text-ink">{family}</span>,
          aside: <span className="w-16 text-right text-sm text-ink-2 tabular-nums">{rows.length} 个规格</span>,
          rows,
          open: Boolean(needle) || !closed.includes(family),
          onToggle: () => setClosed(list => (list.includes(family) ? list.filter(item => item !== family) : [...list, family])),
        };
      })} />
  </div>;
}

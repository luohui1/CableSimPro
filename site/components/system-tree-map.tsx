'use client';

// 交互式树状文档地图 + 四层平台架构树（工程制图纸面风格，带真实树状连线与展开/折叠控制）
import { ArrowUpRight, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { cn } from '@/lib/cn';
import { DOC_TAXONOMY, renderTreeIcon, type TreeBranchSpec, type TreeLeafSpec } from '@/lib/doc-tree';

import { Window } from './landing/window';

function LeafRow({ item, isLast }: { item: TreeLeafSpec; isLast: boolean }) {
  return (
    <li className="relative pl-6">
      {/* 垂直树干连线（最后一项只画到中线） */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute left-2 top-0 w-px bg-fd-foreground/25',
          isLast ? 'h-[15px]' : 'bottom-0',
        )}
      />
      {/* 水平树枝连线 */}
      <span aria-hidden className="pointer-events-none absolute left-2 top-[15px] h-px w-3 bg-fd-foreground/25" />
      <Link
        href={item.url}
        className="group flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-2 py-1 text-sm transition-colors hover:bg-brand-soft/70"
      >
        <span className="inline-flex items-baseline gap-2 font-medium text-fd-foreground group-hover:text-brand">
          <span>{item.title}</span>
          {item.badge && (
            <span className="border border-brand/60 bg-brand-soft/80 px-1.5 py-px font-mono text-[11px] font-normal text-brand">
              {item.badge}
            </span>
          )}
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-fd-muted-foreground">
          {item.note && <span className="hidden xl:inline">{item.note}</span>}
          <ArrowUpRight className="size-3.5 opacity-55 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand group-hover:opacity-100" />
        </span>
      </Link>
    </li>
  );
}

function BranchCard({
  branch,
  open,
  onToggle,
}: {
  branch: TreeBranchSpec;
  open: boolean;
  onToggle: () => void;
}) {
  const directCount = branch.directItems?.length ?? 0;
  const subCount = branch.subgroups?.reduce((acc, sg) => acc + sg.items.length, 0) ?? 0;
  const totalCount = directCount + subCount;

  return (
    <div className="border border-fd-foreground/70 bg-fd-card shadow-[4px_4px_0_0_rgb(28_26_23/0.08)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-start justify-between gap-3 border-b border-fd-foreground/20 bg-fd-background/70 px-4 py-3 text-left transition-colors hover:bg-brand-soft/45"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center border border-fd-foreground/65 bg-fd-card font-pixel text-sm text-brand">
            {branch.code}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {renderTreeIcon(branch.iconKey, 'size-4 shrink-0 text-brand')}
              <span className="font-display text-xl tracking-wide text-fd-foreground">{branch.title}</span>
              <span className="border border-fd-foreground/35 px-1.5 py-px font-mono text-[11px] text-fd-muted-foreground">
                {totalCount} 篇
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-fd-muted-foreground">{branch.summary}</p>
          </div>
        </div>
        <span className="mt-1 inline-flex shrink-0 items-center gap-1 font-mono text-xs text-fd-muted-foreground">
          {open ? <ChevronDown className="size-4 text-brand" /> : <ChevronRight className="size-4" />}
        </span>
      </button>

      {open && (
        <div className="px-4 py-3">
          <ul className="list-none m-0 p-0">
            {(branch.directItems ?? []).map((leaf, idx) => {
              const noSubgroups = !branch.subgroups || branch.subgroups.length === 0;
              const isLast = noSubgroups && idx === (branch.directItems?.length ?? 0) - 1;
              return <LeafRow key={leaf.id} item={leaf} isLast={isLast} />;
            })}

            {(branch.subgroups ?? []).map((sg, sgIdx) => {
              const isLastGroup = sgIdx === (branch.subgroups?.length ?? 0) - 1;
              return (
                <li key={sg.id} className="relative pl-6 pt-1.5">
                  <span
                    aria-hidden
                    className={cn(
                      'pointer-events-none absolute left-2 top-0 w-px bg-fd-foreground/25',
                      isLastGroup ? 'h-[19px]' : 'bottom-0',
                    )}
                  />
                  <span aria-hidden className="pointer-events-none absolute left-2 top-[19px] h-px w-3 bg-fd-foreground/25" />
                  <div className="inline-flex items-center gap-1.5 border border-fd-foreground/35 bg-fd-background px-2 py-0.5 font-mono text-xs font-medium text-fd-foreground">
                    {renderTreeIcon(sg.iconKey, 'size-3.5 shrink-0 text-brand')}
                    <span>{sg.title}</span>
                    <span className="text-fd-muted-foreground">({sg.items.length})</span>
                  </div>
                  <ul className="list-none m-0 mt-1 p-0 pl-2">
                    {sg.items.map((leaf, lIdx) => (
                      <LeafRow key={leaf.id} item={leaf} isLast={lIdx === sg.items.length - 1} />
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 交互式全站文档树（支持一键全部展开/收起，首页与 /docs/ 总览共用） */
export function SystemTreeMap({ compact = false }: { compact?: boolean }) {
  const allBranchIds = DOC_TAXONOMY.flatMap((d) => d.branches.map((b) => b.id));
  const defaultIds = compact ? ['quickstart', 'guide', 'methods'] : allBranchIds;
  const [openSet, setOpenSet] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(allBranchIds.map((id) => [id, defaultIds.includes(id)])),
  );

  const toggle = (id: string) => setOpenSet((prev) => ({ ...prev, [id]: !prev[id] }));
  const setAll = (val: boolean) => setOpenSet(Object.fromEntries(allBranchIds.map((id) => [id, val])));

  return (
    <div className="not-prose my-6">
      <Window title="cablesimpro — documentation-tree (4 层 · 6 分支 · 50+ 页)">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-fd-foreground/60 bg-fd-background px-4 py-2.5 text-xs">
          <span className="font-mono text-fd-muted-foreground">
            树状目录：按「入门部署 → 业务指南 → 算法依据 → 扩展与边界」四层组织，点击任一节点直达正文
          </span>
          <div className="flex items-center gap-2 font-mono">
            <button
              type="button"
              onClick={() => setAll(true)}
              className="inline-flex cursor-pointer items-center gap-1 border border-fd-foreground/60 bg-fd-card px-2.5 py-1 text-fd-foreground transition-colors hover:bg-brand-soft"
            >
              <ChevronsUpDown className="size-3.5 text-brand" />
              全部展开
            </button>
            <button
              type="button"
              onClick={() => setAll(false)}
              className="inline-flex cursor-pointer items-center gap-1 border border-fd-foreground/60 bg-fd-card px-2.5 py-1 text-fd-foreground transition-colors hover:bg-brand-soft"
            >
              <ChevronsDownUp className="size-3.5" />
              全部折叠
            </button>
          </div>
        </div>

        <div className="space-y-6 p-4 sm:p-6">
          {DOC_TAXONOMY.map((layer) => (
            <div key={layer.domain} className="space-y-3">
              <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-brand">
                <span className="size-1.5 rotate-45 bg-brand" />
                <span>{layer.domain}</span>
                <span className="h-px flex-1 bg-fd-foreground/20" />
              </div>
              <div className={cn('grid gap-4', layer.branches.length > 1 ? 'lg:grid-cols-2' : 'grid-cols-1')}>
                {layer.branches.map((branch) => (
                  <BranchCard
                    key={branch.id}
                    branch={branch}
                    open={Boolean(openSet[branch.id])}
                    onToggle={() => toggle(branch.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Window>
    </div>
  );
}

/** 平台四层工程架构与追溯树（无需等待客户端图形库，零延迟直出） */
export function ArchitectureTreeDiagram() {
  const layers = [
    {
      level: 'L1 · 交付与签审层',
      role: '人工复核签发（不重新计算）',
      nodes: ['研究计算书（PDF / HTML）', '产品规格书（客户版 / 内部版）', '多工况载流量表（PDF / CSV / Excel）', '四级签栏 + 独立逐值追溯页'],
    },
    {
      level: 'L2 · 四大业务工作流',
      role: '工作台可视化交互 + Agent 受控提案协同',
      nodes: ['型号库与结构表导入（五步向导）', '型号设计（结构 / 电气 / 短路 / 核对）', '载流量研究（稳态 / 扫描 / 选型 / 对比）', 'Agent 边车（只读查询 · 待审提案卡）'],
    },
    {
      level: 'L3 · 封签计算插件层',
      role: '12 个独立子进程插件（cablesim.plugin/2 · SHA-256 逐文件封签）',
      nodes: ['IEC 60287 / GB 50217 / 热网络（本机代数）', 'GB/T 12706 & 3956 标准核对 + 依据库', 'OCCT 实体几何建模 + 电气/短路计算', 'Slurm 超算有限元热场 / 电热耦合 / 混合模型'],
    },
    {
      level: 'L4 · 宿主工程底座',
      role: 'FastAPI Kernel + SQLite 工程库（宿主不内置任何计算公式）',
      nodes: ['SI 国际单位制领域事实与引用校验', '运行前预检（缺项与超范围明确拒算）', '不可变运行快照（冻结输入、方法与封签）', '在线快照备份与独占校验恢复'],
    },
  ];

  return (
    <div className="not-prose my-6">
      <Window title="cablesimpro — system-architecture (四层解耦与可追溯架构)">
        <div className="divide-y divide-fd-foreground/25 p-4 sm:p-5">
          {layers.map((item, idx) => (
            <div key={item.level} className={cn('grid gap-3 md:grid-cols-[240px_1fr] md:items-center', idx > 0 && 'pt-3.5', idx < layers.length - 1 && 'pb-3.5')}>
              <div>
                <p className="font-mono text-xs font-semibold text-brand">{item.level}</p>
                <p className="mt-0.5 text-xs text-fd-muted-foreground">{item.role}</p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {item.nodes.map((n) => (
                  <div key={n} className="flex items-center gap-2 border border-fd-foreground/45 bg-fd-background px-3 py-1.5 text-xs font-medium text-fd-foreground">
                    <span className="size-1.5 shrink-0 rotate-45 bg-brand" />
                    <span>{n}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Window>
    </div>
  );
}

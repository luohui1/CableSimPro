'use client';

// 电缆热模型的验证矩阵：5 种结构 × 5 类敷设，格子颜色深浅表示最大载流量误差，点或悬停一格看这一组合的验证数字。
// 数据见 thermal-model.json（独立电缆热模型 v2.0.0 的验证结果摘录）。
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';

import { cn } from '@/lib/cn';

import data from './thermal-model.json';
import { Window } from './window';

const worst = Math.max(...data.structures.flatMap((structure) => structure.cells.map((cell) => cell.amp)));

export function ThermalMatrix() {
  const [picked, setPicked] = useState<[number, number]>([4, 0]);
  const structure = data.structures[picked[0]];
  const cell = structure.cells[picked[1]];

  return (
    <Window title={`cable-thermal-model v${data.version}`} bodyClassName="p-4 sm:p-6">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="w-[26%] text-left font-mono text-xs font-normal text-fd-muted-foreground">结构 \ 敷设</th>
              {data.scenes.map((scene, column) => (
                <th
                  key={scene}
                  className={cn('pb-1 text-center text-[13px] font-normal transition-colors', column === picked[1] ? 'text-brand' : 'text-fd-muted-foreground')}
                >
                  {scene}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.structures.map((item, row) => (
              <tr key={item.id}>
                <th className={cn('whitespace-nowrap pr-2 text-left font-mono text-xs font-normal transition-colors', row === picked[0] ? 'text-brand' : 'text-fd-foreground')}>
                  {item.name}
                </th>
                {item.cells.map((value, column) => {
                  const active = row === picked[0] && column === picked[1];
                  return (
                    <td key={column} className="p-0">
                      <button
                        type="button"
                        aria-label={`${item.name}，${data.scenes[column]}：最大载流量误差 ${value.amp}%`}
                        aria-pressed={active}
                        onPointerEnter={() => setPicked([row, column])}
                        onFocus={() => setPicked([row, column])}
                        onClick={() => setPicked([row, column])}
                        className={cn(
                          'relative block h-11 w-full border font-mono text-xs transition-[transform,border-color] duration-150',
                          active ? 'z-10 scale-[1.06] border-fd-foreground' : 'border-fd-foreground/25 hover:border-fd-foreground/60',
                        )}
                      >
                        <span aria-hidden className="absolute inset-0 bg-brand" style={{ opacity: 0.1 + (value.amp / worst) * 0.75 }} />
                        <span className="relative">{value.amp < 0.005 ? '<0.01%' : `${value.amp.toFixed(2)}%`}</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 min-h-[76px] border border-fd-foreground/70 bg-fd-background px-4 py-3 text-sm">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${picked[0]}-${picked[1]}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            <p className="flex flex-wrap gap-2 font-mono text-xs">
              <span className="border border-fd-foreground/40 px-1.5 py-px">{structure.name}</span>
              <span className="border border-fd-foreground/40 px-1.5 py-px">{data.scenes[picked[1]]}</span>
              <span className="border border-fd-foreground/40 px-1.5 py-px text-fd-muted-foreground">
                {cell.kind === 'check' ? `独立复核 ${cell.n} 例` : `留出集 ${cell.n} 例`}
              </span>
            </p>
            <p className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1">
              <span>
                最大载流量相对误差 <strong className="font-pixel text-base font-normal text-brand">{cell.amp.toFixed(4)}%</strong>
              </span>
              <span>
                最大导体温度偏差 <strong className="font-pixel text-base font-normal text-brand">{cell.temp.toFixed(4)} ℃</strong>
              </span>
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </Window>
  );
}

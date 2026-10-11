import { useState } from 'react';
import { array, numeric, optionalRecord, record, text } from '@/api/client';
import { EmptyState, ErrorState } from '@/components/states';
import { Select } from '@/components/ui/select';
import { analysisValue, type AnalysisRow } from './analysis';
import { displayName } from '@/lib/display-names';
import { Button } from '@/components/ui/button';
import { formatNumber, significantNumber } from '@/lib/format';
import { useCanvasSize } from '@/features/drawing/use-canvas-size';

function CurveDiagram({times,maximum,series,active}:{times:number[];maximum:number;series:Record<string,unknown>[];active:number}){
  const {host,size}=useCanvasSize(),left=62,width=Math.max(1,size.width-90),top=22,height=178;
  const x=(time:number)=>left+Math.log(time/times[0])/Math.log(times[times.length-1]/times[0])*width;
  const y=(value:number)=>top+height-value/(maximum||1)*height;
  return <div ref={host}><svg viewBox={`0 0 ${size.width} 264`} role="img" aria-label="短路电流随持续时间变化；横轴对数时间，纵轴 kA">
    {[0,.25,.5,.75,1].map(factor=><g key={factor}><line className="type-curve-grid" x1={left} x2={left+width} y1={y(maximum*factor)} y2={y(maximum*factor)} /><text x={left-9} y={y(maximum*factor)+5} textAnchor="end">{formatNumber(maximum*factor*.001,1)}</text></g>)}
    {[times[0],...times.filter(time=>[.2,.5,1,2].includes(time)),times[times.length-1]].map(time=><text key={time} x={x(time)} y="224" textAnchor="middle">{significantNumber(time,3)}</text>)}
    <text x={left} y="15">kA</text><text x={size.width-28} y="252" textAnchor="end">持续时间 / s</text>
    {series.map(item=>{let connected=false;const path=array(item.values_a,'曲线电流').map((value,index)=>{const current=numeric(value);if(current===null){connected=false;return '';}const segment=(connected?'L':'M')+x(times[index])+','+y(current);connected=true;return segment;}).join('');return <path key={text(item.row_id)} className={'type-curve-line '+(item.model==='nonadiabatic'?'is-corrected':'')} d={path}><title>{text(item.title)}</title></path>;})}
    {active>=0&&<line className="type-curve-cursor" x1={x(times[active])} x2={x(times[active])} y1={top} y2={top+height} />}
  </svg></div>;
}

export function ShortCircuitCurve({ artifact, rows, onSelect, onConfigure }: { artifact: Record<string, unknown>; rows: AnalysisRow[]; onSelect: (row: AnalysisRow) => void; onConfigure?: () => void }) {
  const [chosen, setChosen] = useState(''), [point, setPoint] = useState('');
  if (!artifact.curve) return <EmptyState title="此运行未保存时间曲线" description="按已保存条件执行当前插件后可读取插件生成的采样点。" />;
  let times: number[] = [], series: Record<string, unknown>[] = [];
  try {
    const curve = record(artifact.curve, '短路时间曲线');
    if (curve.schema !== 'cablesim.short-circuit-curve/1' || curve.axis !== 'log' || curve.time_unit !== 's' || curve.current_unit !== 'A') throw Error('曲线契约或单位不匹配');
    times = array(curve.times_s, '曲线时间').map(value => { const time = numeric(value); if (time === null || time <= 0) throw Error('曲线时间不是正有限数'); return time; });
    if (times.length < 2 || times.some((time, index) => index > 0 && time <= times[index - 1])) throw Error('曲线时间未按升序保存');
    series = array(curve.series, '曲线序列').map(value => { const item = record(value, '曲线序列'), values = array(item.values_a, '曲线电流'); if (!rows.some(row => row.id === item.row_id) || values.length !== times.length || values.some(value => value !== null && (numeric(value) === null || numeric(value)! < 0))) throw Error('曲线序列与结果行或时间不匹配'); return item; });
  } catch (failure) { return <ErrorState title="短路曲线不可用" description={String(failure)} />; }
  const components = [...new Set(series.map(item => { const target = optionalRecord(item.target); return (text(target.core_id) || 'common') + '/' + text(target.role); }))];
  const selected = components.includes(chosen) ? chosen : components[0];
  const componentLabel = (value: string) => {
    const item = series.find(item => { const target = optionalRecord(item.target); return (text(target.core_id) || 'common') + '/' + text(target.role) === value; })!;
    const target = optionalRecord(item.target), core = rows.find(row => row.id === item.row_id)?.title.split(' · ')[0];
    return (target.scope === 'core' ? core || '电缆芯' : '共同层') + ' · ' + displayName(text(target.role));
  };
  const displayed = series.filter(item => { const target = optionalRecord(item.target); return (text(target.core_id) || 'common') + '/' + text(target.role) === selected; });
  const values = displayed.flatMap(item => array(item.values_a, '曲线电流').filter((value): value is number => numeric(value) !== null));
  if (!values.length) return <EmptyState title="所选组件未生成有效时间曲线" description="填写短路时间、初末温度及来源后重新运行；组件构造缺项见结果表。" action={onConfigure ? <Button onClick={onConfigure}>填写短路工况</Button> : undefined} />;
  const maximum = Math.max(...values);
  const active = point === '' ? -1 : Number(point);
  return <section className="type-curve" aria-label="短路电流持续时间曲线">
    <div className="type-result-toolbar"><Select label="曲线组件" value={selected} options={components.map(value => ({ value, label: componentLabel(value) }))} onChange={value => { setChosen(value); setPoint(''); }} /><Select label="采样时间" value={point || undefined} placeholder="选择采样点" options={times.map((time, index) => ({ value: String(index), label: significantNumber(time,3) + ' s' }))} onChange={setPoint} /></div>
    <CurveDiagram times={times} maximum={maximum} series={displayed} active={active} />
    <div className="type-curve-readout">{displayed.map(item => { const row = rows.find(row => row.id === item.row_id)!; return <Button variant="secondary" size="compact" key={row.id} onClick={() => onSelect(row)}>{item.model === 'adiabatic' ? '绝热' : '非绝热'}{active >= 0 ? ' · ' + analysisValue({ value: array(item.values_a, '曲线电流')[active], unit: 'A' }) : ''}</Button>; })}<span>全部采样点来自保存的插件工件</span></div>
  </section>;
}

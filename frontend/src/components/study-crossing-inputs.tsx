import { useQuery } from '@tanstack/react-query';
import { inputContractQuery } from '@/api/input-contracts';
import { numeric, optionalRecord, text } from '@/api/client';
import { useStudy } from './study-provider';
import { NumberField } from './ui/number-field';
import { Button } from './ui/button';
import { Tooltip } from './ui/tooltip';
import { methodCardsQuery } from '@/lib/study-queries';

/** Crossings are method inputs, not a second domain object schema. Labels,
 * units and bounds come from the selected sealed plugin contract. */
export function StudyCrossingInputs({historical, placement='all'}: {historical:boolean;placement?:'active'|'optional'|'all'}) {
  const context=useStudy();
  const saved=context.runs.at(-1);
  const definition=historical ? optionalRecord(optionalRecord(saved?.snapshot).definition) : context.draft?.definition || context.study.definition;
  const method=optionalRecord(definition.method);
  const parameters=optionalRecord(definition.parameters);
  const catalog=useQuery(methodCardsQuery());
  const plugin=catalog.data?.find(row=>optionalRecord(row.method).plugin_id===method.plugin_id);
  const capability=(Array.isArray(plugin?.capabilities) ? plugin.capabilities : []).map(optionalRecord).find(row=>row.id===method.capability);
  // The small catalog advertises field names only. Saved crossings still read
  // their exact historical contract even if the installed capability removed it.
  const supportsCrossings=Array.isArray(capability?.parameter_fields) && capability.parameter_fields.includes('crossing_heat_sources');
  const hasSavedCrossings=Array.isArray(parameters.crossing_heat_sources) && parameters.crossing_heat_sources.length>0;
  const contracts=useQuery({...inputContractQuery(method as typeof context.study.definition.method), enabled:supportsCrossings || hasSavedCrossings});
  let field:Record<string,unknown>={};
  try {if(contracts.data)field=optionalRecord(optionalRecord(contracts.data.parameter_schema).properties).crossing_heat_sources as Record<string,unknown> || {};} catch { /* Contract failure is already shown by the method inspector. */ }
  if(!field.items)return null;
  const rows=(Array.isArray(parameters.crossing_heat_sources) ? parameters.crossing_heat_sources : []).map(optionalRecord);
  const properties=optionalRecord(optionalRecord(field.items).properties);
  function write(next:Record<string,unknown>[]) {
    const current=context.draft?.definition || context.study.definition;
    const changed={...optionalRecord(current.parameters)};
    if(next.length)changed.crossing_heat_sources=next;else delete changed.crossing_heat_sources;
    context.editDefinition({...current,parameters:changed,input_sources:{...current.input_sources,
      '/parameters/crossing_heat_sources':{kind:'user',reference:'工程师填写交叉热源；逐条具体出处见 source。',reviewed:false}}});
  }
  if(placement==='active' && !rows.length || placement==='optional' && rows.length)return null;
  if(!rows.length)return <section className="study-crossing-empty" aria-label="附加热源">
    <Tooltip content={text(field.description)}><span tabIndex={0}>附加热源</span></Tooltip><span className="muted">未设置</span>
    {!historical && <Button size="compact" variant="ghost" disabled={context.saving} onClick={()=>write([{}])}>添加</Button>}
  </section>;
  return <section className="input-section study-crossing-inputs" aria-label={text(field.title)}>
    <h3>{text(field.title)}</h3>
    {rows.map((row,index)=><fieldset key={index} className="input-form-grid"><legend>{text(row.label) || `热源 ${index+1}`}</legend>
      {Object.entries(properties).map(([key,raw])=>{
        const spec=optionalRecord(raw),label=text(spec.title),unit=text(optionalRecord(spec['x-unit']).si) || text(spec['x-unit']);
        // Engineers enter crossing angles in degrees; the saved contract remains SI radians.
        const angular=unit==='rad',scale=angular ? 180/Math.PI : 1;
        const saved=numeric(row[key]),minimum=numeric(spec.exclusiveMinimum) ?? numeric(spec.minimum),maximum=numeric(spec.maximum);
        const update=(value:unknown)=>write(rows.map((r,i)=>i===index ? {...r,[key]:value} : r));
        return spec.type==='number' ? <NumberField key={key} label={label} value={saved===null ? null : saved*scale} unit={angular ? '°' : unit} precision={angular ? 1 : 3}
          path={`/parameters/crossing_heat_sources/${index}/${key}`} min={minimum===null ? undefined : minimum*scale}
          max={maximum===null ? undefined : maximum*scale} required minExclusive={spec.exclusiveMinimum!==undefined} locked={historical} disabled={context.saving} onCommit={value=>update(value===null ? null : value/scale)} />
          : <label key={key} className="text-field" data-field-path={`/parameters/crossing_heat_sources/${index}/${key}`}>{label}<input value={text(row[key])} required readOnly={historical} disabled={context.saving} onChange={e=>update(e.target.value)} /></label>;
      })}
      {!historical && <Button variant="ghost" onClick={()=>write(rows.filter((_,i)=>i!==index))}>移除热源 {index+1}</Button>}
    </fieldset>)}
    {!historical && <Button disabled={context.saving || rows.length>=Number(field.maxItems)} onClick={()=>write([...rows,{}])}>添加交叉热源</Button>}
    <Tooltip content={text(field.description)}><span tabIndex={0} className="muted">范围与依据</span></Tooltip>
  </section>;
}

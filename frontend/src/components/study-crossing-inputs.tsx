import { useQuery } from '@tanstack/react-query';
import { exactContract, inputContracts } from '@/api/input-contracts';
import { numeric, optionalRecord, text } from '@/api/client';
import { useStudy } from './study-provider';
import { NumberField } from './ui/number-field';
import { Button } from './ui/button';

/** Crossings are method inputs, not a second domain object schema. Labels,
 * units and bounds come from the selected sealed plugin contract. */
export function StudyCrossingInputs({historical}: {historical:boolean}) {
  const context=useStudy();
  const saved=context.runs.at(-1);
  const definition=historical ? optionalRecord(optionalRecord(saved?.snapshot).definition) : context.draft?.definition || context.study.definition;
  const method=optionalRecord(definition.method);
  const contracts=useQuery({queryKey:['input-contracts'],queryFn:({signal})=>inputContracts(signal)});
  let field:Record<string,unknown>={};
  try {if(contracts.data)field=optionalRecord(optionalRecord(exactContract(contracts.data,method as typeof context.study.definition.method).parameter_schema).properties).crossing_heat_sources as Record<string,unknown> || {};} catch { /* Contract failure is already shown by the method inspector. */ }
  if(!field.items)return null;
  const parameters=optionalRecord(definition.parameters);
  const rows=(Array.isArray(parameters.crossing_heat_sources) ? parameters.crossing_heat_sources : []).map(optionalRecord);
  const properties=optionalRecord(optionalRecord(field.items).properties);
  function write(next:Record<string,unknown>[]) {
    const current=context.draft?.definition || context.study.definition;
    const changed={...optionalRecord(current.parameters)};
    if(next.length)changed.crossing_heat_sources=next;else delete changed.crossing_heat_sources;
    context.editDefinition({...current,parameters:changed,input_sources:{...current.input_sources,
      '/parameters/crossing_heat_sources':{kind:'user',reference:'工程师填写交叉热源；逐条具体出处见 source。',reviewed:false}}});
  }
  return <section className="input-section study-crossing-inputs" aria-label={text(field.title)}>
    <h3>{text(field.title)}</h3>
    {!rows.length && <p className="muted">未设置交叉热源</p>}
    {rows.map((row,index)=><fieldset key={index} className="input-form-grid"><legend>{text(row.label) || `热源 ${index+1}`}</legend>
      {Object.entries(properties).map(([key,raw])=>{
        const spec=optionalRecord(raw),label=text(spec.title),unit=text(optionalRecord(spec['x-unit']).si) || text(spec['x-unit']);
        const update=(value:unknown)=>write(rows.map((r,i)=>i===index ? {...r,[key]:value} : r));
        return spec.type==='number' ? <NumberField key={key} label={label} value={numeric(row[key])} unit={unit} precision={3}
          path={`/parameters/crossing_heat_sources/${index}/${key}`} min={numeric(spec.exclusiveMinimum) ?? numeric(spec.minimum) ?? undefined}
          max={numeric(spec.maximum) ?? undefined} required minExclusive={spec.exclusiveMinimum!==undefined} locked={historical} disabled={context.saving} onCommit={update} />
          : <label key={key} className="text-field" data-field-path={`/parameters/crossing_heat_sources/${index}/${key}`}>{label}<input value={text(row[key])} required readOnly={historical} disabled={context.saving} onChange={e=>update(e.target.value)} /></label>;
      })}
      {!historical && <Button variant="ghost" onClick={()=>write(rows.filter((_,i)=>i!==index))}>移除热源 {index+1}</Button>}
    </fieldset>)}
    {!historical && <Button disabled={context.saving || rows.length>=Number(field.maxItems)} onClick={()=>write([...rows,{}])}>添加交叉热源</Button>}
    <p className="muted">{text(field.description)}</p>
  </section>;
}

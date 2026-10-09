import { createRoot } from 'react-dom/client';
import { array, optionalRecord, text } from '@/api/client';
import type { DomainDocument } from '@/lib/domain-fields';
import './study-report-drawing.css';
import { caseRun, hydrateCaseInputs } from '@/features/cad/saved-field-controls';
import { selectionView } from '@/lib/selection-view';

/** Read-only export of the workbench drawing, using immutable saved case inputs. */
export async function reportSectionImages(run: Record<string, unknown>) {
  const { LayingSection } = await import('@/features/drawing');
  const output = optionalRecord(run.output);
  const cases = array(output.cases).map(optionalRecord).filter(row => row.status === 'succeeded');
  const definition=optionalRecord(optionalRecord(run.snapshot).definition);
  const recommended = optionalRecord(definition.driver).kind === 'selection' ? selectionView(run).recommendation?.id : undefined;
  const chosen = cases.find(row => row.case_id === recommended) || cases[0];
  if (!chosen) return [];
  const hydrated = await hydrateCaseInputs(caseRun(run,text(chosen.case_id)),AbortSignal.timeout(9000));
  const saved = array(optionalRecord(hydrated.snapshot).cases).map(optionalRecord).find(row => row.case_id === chosen.case_id);
  const document = optionalRecord(saved?.input) as DomainDocument;
  if (!Array.isArray(document.sections) || !document.sections.length) return [];
  if(document.sections.length > 3)throw Error('本次有超过三个敷设截面，请按工况分别生成计算书。');
  const annotations: Record<string,{text:string;emphasis?:boolean}> = {};
  const trace = optionalRecord(optionalRecord(chosen.artifacts)['x-cablesim.iec60287-trace']);
  for (const state of array(optionalRecord(trace.operating).cable_states).map(optionalRecord)) {
    if (typeof state.conductor_temperature_c === 'number') annotations[text(state.entity)] = {text:`${state.conductor_temperature_c.toFixed(1)} °C`,emphasis:Number(state.margin_k) < 0};
  }
  for (const result of array(chosen.results).map(optionalRecord)) {
    if (result.key === 'conductor_temperature' && result.status === 'available' && typeof result.value === 'number' && !annotations[text(result.entity)]) annotations[text(result.entity)] = {text:`${(result.value - 273.15).toFixed(1)} °C`};
  }
  const host = window.document.createElement('div');
  host.setAttribute('aria-hidden','true');host.setAttribute('data-theme','light');
  host.className='study-report-drawing-export';
  window.document.body.append(host);
  const root = createRoot(host), images = [];
  try {
    await window.document.fonts.ready;
    for (const section of document.sections) {
      root.render(<LayingSection key={section.id} document={document} sectionId={section.id} editable={false} state="success" showDimensions annotations={annotations} />);
      let svg: SVGSVGElement | null = null;
      for (let attempt=0;attempt<60;attempt++) {
        await new Promise(resolve => setTimeout(resolve,50));
        svg=host.querySelector('svg.drawing-svg');
        if (svg && svg.getBoundingClientRect().width > 100 && svg.querySelector('text')) break;
      }
      if (!svg) throw Error('敷设截面导出失败；保存运行未改变。');
      const copy=svg.cloneNode(true) as SVGSVGElement;
      const originals=[svg,...svg.querySelectorAll('*')], copies=[copy,...copy.querySelectorAll('*')];
      for (let i=0;i<originals.length;i++) {
        const style=getComputedStyle(originals[i]);
        for (const key of ['color','fill','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-linecap','stroke-linejoin','stroke-dasharray','paint-order','vector-effect','font-family','font-size','font-weight','opacity','text-anchor','dominant-baseline']) copies[i].setAttribute(key,style.getPropertyValue(key));
      }
      const size=svg.getBoundingClientRect(), width=Math.round(size.width*2),height=Math.round(size.height*2);
      copy.setAttribute('xmlns','http://www.w3.org/2000/svg');copy.setAttribute('width',String(width));copy.setAttribute('height',String(height));
      const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml'}));
      try {
        const image=new Image();image.src=url;await image.decode();
        const canvas=window.document.createElement('canvas');canvas.width=width;canvas.height=height;
        const context=canvas.getContext('2d');if (!context) throw Error('浏览器无法导出截面图。');
        context.fillStyle='white';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);
        images.push({run_id:text(run.id),case_id:text(chosen.case_id),section_id:section.id,input_digest:text(run.input_digest),width,height,png_base64:canvas.toDataURL('image/png').split(',')[1]});
      } finally { URL.revokeObjectURL(url); }
    }
    return images;
  } finally { root.unmount();host.remove(); }
}

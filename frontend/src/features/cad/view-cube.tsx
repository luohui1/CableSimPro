import type { CadView } from './types';

export function ViewCube({ disabled, selected, onView }: { disabled: boolean; selected?: CadView | 'free'; onView: (view: CadView) => void }) {
  const activate = (view: CadView) => { if (!disabled) onView(view); };
  const keys = (event: React.KeyboardEvent<SVGGElement>, view: CadView) => {
    if (['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); activate(view); }
  };
  return <svg className="cad-view-cube" viewBox="0 0 128 132" aria-label="标准视图立方体">
    <g role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label="俯视" aria-pressed={selected === 'top'}
      data-cad-view="top" onClick={() => activate('top')} onKeyDown={event => keys(event, 'top')}>
      <path d="M14 39 64 10 114 39 64 68Z" /><text x="64" y="42">俯视</text>
    </g>
    <g role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label="侧视" aria-pressed={selected === 'front'}
      data-cad-view="front" onClick={() => activate('front')} onKeyDown={event => keys(event, 'front')}>
      <path d="M14 39 64 68V124L14 95Z" /><text x="39" y="88">侧视</text>
    </g>
    <g role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label="端面" aria-pressed={selected === 'end'}
      data-cad-view="end" onClick={() => activate('end')} onKeyDown={event => keys(event, 'end')}>
      <path d="M64 68 114 39V95L64 124Z" /><text x="89" y="88">端面</text>
    </g>
    <g role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label="等轴视图" aria-pressed={selected === 'iso'}
      data-cad-view="iso" onClick={() => activate('iso')} onKeyDown={event => keys(event, 'iso')}>
      <circle className="cad-cube-hit" cx="64" cy="68" r="13" /><circle className="cad-cube-corner" cx="64" cy="68" r="3" />
    </g>
  </svg>;
}

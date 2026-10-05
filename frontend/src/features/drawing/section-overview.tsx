import { fitBounds, screenToWorld, worldToScreen } from './coordinates';
import { SectionObjects } from './section-objects';
import type { SectionGeometry } from './section-geometry';
import type { DrawingView, PixelSize, Section } from './types';

export function SectionOverview({ section, geometry, view, size, onView }: {
  section: Section; geometry: SectionGeometry; view: DrawingView; size: PixelSize; onView: (view: DrawingView) => void;
}) {
  const overviewSize = { width: 160, height: 96 };
  const overviewView = fitBounds(geometry.bounds, overviewSize);
  const topLeft = worldToScreen(screenToWorld({ x: 0, y: 0 }, view, size), overviewView, overviewSize);
  const scale = overviewSize.width / overviewView.widthM;
  return <div className="drawing-overview"><span className="drawing-overview-label">敷设全览</span>
    <svg viewBox="0 0 160 96" role="button" tabIndex={0} aria-label="敷设缩略窗，点击定位，Enter 显示全部"
      data-section-overview onClick={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const point = screenToWorld({ x: (event.clientX - bounds.left) * 160 / bounds.width,
          y: (event.clientY - bounds.top) * 96 / bounds.height }, overviewView, overviewSize);
        onView({ ...view, x: point.x, z: point.z });
      }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onView(fitBounds(geometry.bounds, size)); } }}>
      <SectionObjects section={section} geometry={geometry} view={overviewView} size={overviewSize} selected={null} miniature />
      <rect className="drawing-overview-window" x={topLeft.x} y={topLeft.y} width={view.widthM * scale} height={view.widthM * size.height / size.width * scale} />
    </svg>
  </div>;
}

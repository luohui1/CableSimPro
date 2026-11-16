// What the empty page tells about the product: for each of its two jobs, its own drawing and what the library and the projects hold now.
// The drawings are the design's (ui/pages/gallery/figures.tsx): a cable's section, and a cable in the warmth of its soil.
import { TileFact } from '@/kit/chat/empty';
import { CableSection, SectionThumb } from '@/pages/gallery/figures';
import { useProductLibrary, useProjects } from '@/state/queries';

export const TypeFigure = () => <div className="absolute -right-4 -bottom-10 size-40"><CableSection size={160} /></div>;
export const RatingFigure = () => <SectionThumb width={192} height={112} />;

export function TypeFacts() {
  const series = useProductLibrary().data;
  if (!series) return null;
  return <><TileFact value={series.length}>个系列</TileFact><TileFact value={series.reduce((sum, item) => sum + item.specs, 0)}>个规格</TileFact></>;
}

export function RatingFacts() {
  const projects = useProjects().data;
  if (!projects) return null;
  return <TileFact value={projects.length}>个工程</TileFact>;
}

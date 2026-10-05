import { useEffect, useRef, useState } from "react";
import type { components } from "@/api/generated/schema";
import type { Candidate } from "@/api/documents";
import { Button } from "@/components/ui/button";
type Page = components["schemas"]["PageResponse"];
export function SourcePage({
  did,
  page,
  candidate,
  onRegion,
}: {
  did: string;
  page: Page;
  candidate?: Candidate;
  onRegion: (region: number[]) => void;
}) {
  const [zoom, setZoom] = useState(1),
    [drawing, setDrawing] = useState<number[] | null>(null),
    [imageError, setImageError] = useState(false);
  const start = useRef<number[] | null>(null);
  const scroll = useRef<HTMLDivElement>(null), [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded || !candidate || candidate.page !== page.page || !scroll.current) return;
    const image = scroll.current.querySelector('img');
    if (image) scroll.current.scrollTop = Math.max(0, (candidate.bbox_pt[1] + candidate.bbox_pt[3]) / 2 * image.clientWidth / page.width_pt - scroll.current.clientHeight / 2);
  }, [candidate?.id, loaded, page.page, page.width_pt, zoom]);
  function rectangle(box: number[], kind: string) {
    return (
      <rect
        key={kind}
        className={kind}
        x={box[0]}
        y={box[1]}
        width={box[2] - box[0]}
        height={box[3] - box[1]}
      />
    );
  }
  return (
    <section className="document-original" aria-label="原文页面">
      <div className="document-page-tools">
        <span>原文 · 第 {page.page} 页</span>
        <span className="muted">
          {page.requires_ocr ? "需要离线文字识别" : "原件文字层"}
        </span>
        <Button
          size="compact"
          disabled={zoom <= 0.75}
          onClick={() => setZoom((value) => value - 0.25)}
          aria-label="缩小原文"
        >
          −
        </Button>
        <span>{Math.round(zoom * 100)}%</span>
        <Button
          size="compact"
          disabled={zoom >= 2}
          onClick={() => setZoom((value) => value + 0.25)}
          aria-label="放大原文"
        >
          ＋
        </Button>
      </div>
      <div className="document-page-scroll" ref={scroll} role="region" aria-label="原文滚动区域" tabIndex={0} aria-busy={!loaded && !imageError}>
        {imageError && (
          <p role="alert">
            原文图像读取失败。
            <Button onClick={() => setImageError(false)}>重试图像</Button>
          </p>
        )}
        {!imageError && (
          <div
            className={`document-page-image document-zoom-${Math.round(zoom * 100)}`}
          >
            <img
              key={did + page.page}
              src={`/api/documents/${encodeURIComponent(did)}/pages/${page.page}/image`}
              alt={`原始 PDF 第 ${page.page} 页`}
            width={page.width_pt}
            height={page.height_pt}
              draggable={false}
            onLoad={() => setLoaded(true)}
              onError={() => setImageError(true)}
            />
            <svg
              viewBox={`0 0 ${page.width_pt} ${page.height_pt}`}
              role="img"
              aria-label="原文证据高亮，可拖动框选提取范围"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                start.current = [
                  ((event.clientX - bounds.left) / bounds.width) *
                    page.width_pt,
                  ((event.clientY - bounds.top) / bounds.height) *
                    page.height_pt,
                ];
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!start.current) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                const x = Math.max(
                    0,
                    Math.min(
                      page.width_pt,
                      ((event.clientX - bounds.left) / bounds.width) *
                        page.width_pt,
                    ),
                  ),
                  y = Math.max(
                    0,
                    Math.min(
                      page.height_pt,
                      ((event.clientY - bounds.top) / bounds.height) *
                        page.height_pt,
                    ),
                  );
                setDrawing([
                  Math.min(start.current[0], x),
                  Math.min(start.current[1], y),
                  Math.max(start.current[0], x),
                  Math.max(start.current[1], y),
                ]);
              }}
              onPointerUp={() => {
                if (
                  drawing &&
                  drawing[2] - drawing[0] > 3 &&
                  drawing[3] - drawing[1] > 3
                )
                  onRegion(
                    drawing.map((value) => Math.round(value * 100) / 100),
                  );
                start.current = null;
                setDrawing(null);
              }}
              onPointerCancel={() => {
                start.current = null;
                setDrawing(null);
              }}
            >
              {candidate?.page === page.page &&
                rectangle(candidate.bbox_pt, "evidence-highlight")}
              {candidate?.page === page.page &&
                candidate.header_bbox_pt &&
                rectangle(candidate.header_bbox_pt, "header-highlight")}
              {drawing && rectangle(drawing, "region-highlight")}
            </svg>
          </div>
        )}
      </div>
    </section>
  );
}

import { useEffect, useRef } from "react";
import type { TemperatureView, FieldSample } from "@/lib/temperature-view";
import { formatNumber, engineeringQuantity } from "@/lib/format";

export function TemperaturePlot({
  data,
  selected,
  onSelect,
  zoom = 1,
}: {
  data: TemperatureView;
  selected?: string;
  onSelect: (sample: FieldSample) => void;
  zoom?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const transformed = useRef<{ sample: FieldSample; x: number; y: number }[]>(
    [],
  );
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    function paint() {
      const node = canvas.current;
      if (!node) return;
      const bounds = node.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const style = getComputedStyle(node),
        ratio = Math.min(devicePixelRatio || 1, 2),
        width = Math.round(bounds.width),
        height = Math.round(bounds.height);
      node.width = Math.round(width * ratio);
      node.height = Math.round(height * ratio);
      const context = node.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      context.fillStyle = style.getPropertyValue("--panel").trim();
      context.fillRect(0, 0, width, height);
      let x0 = Infinity,
        x1 = -Infinity,
        z0 = Infinity,
        z1 = -Infinity;
      for (const [x, z] of data.points) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      const domainBounds = { x0, x1, z0, z1 };
      const padding = parseFloat(style.getPropertyValue("--space-12"));
      if (zoom >= 1 && data.geometry && data.section) {
        // Fit the laying objects, not the far lower edge of a soil layer.
        const bottoms = [
          ...data.geometry.cables.map((cable) => cable.z - cable.shape.radiusM),
          ...(data.section.enclosures || []).map(
            (item) =>
              item.z -
              (item.type === "duct"
                ? item.outer_diameter || 0
                : item.height || 0) /
                2,
          ),
        ];
        if (data.section.backfill)
          bottoms.push(
            data.section.backfill.z - data.section.backfill.height / 2,
          );
        const region = {
          ...data.geometry.bounds,
          bottom: bottoms.length
            ? Math.min(...bottoms)
            : data.geometry.bounds.bottom,
        };
        const depth = Math.max(
          region.top - region.bottom,
          region.right - region.left,
          0.1,
        );
        const margin = depth * 0.2;
        z1 = Math.min(
          domainBounds.z1,
          data.section.kind === "ground" ? 0 : region.top + margin,
        );
        z0 = Math.max(domainBounds.z0, region.bottom - margin);
        x0 = Math.max(domainBounds.x0, region.left - margin);
        x1 = Math.min(domainBounds.x1, region.right + margin);
        const requiredWidth =
          ((z1 - z0) * (width - padding * 2)) / (height - padding * 2);
        if (requiredWidth > x1 - x0) {
          const middle = (x0 + x1) / 2;
          x0 = Math.max(domainBounds.x0, middle - requiredWidth / 2);
          x1 = Math.min(domainBounds.x1, middle + requiredWidth / 2);
        }
      }
      if (zoom === 2 && data.geometry?.cables.length) {
        const cables = data.geometry.cables;
        x0 = Math.max(domainBounds.x0, Math.min(...cables.map(c => c.x - c.shape.radiusM)) - 1);
        x1 = Math.min(domainBounds.x1, Math.max(...cables.map(c => c.x + c.shape.radiusM)) + 1);
        z0 = Math.max(domainBounds.z0, Math.min(...cables.map(c => c.z - c.shape.radiusM)) - 1);
        z1 = Math.min(domainBounds.z1, Math.max(...cables.map(c => c.z + c.shape.radiusM)) + 1);
      }
      if (zoom > 2) {
        const spanX = (x1 - x0) / zoom,
          spanZ = (z1 - z0) / zoom;
        x0 = Math.max(
          domainBounds.x0,
          Math.min(data.hotspot.point[0] - spanX / 2, domainBounds.x1 - spanX),
        );
        z0 = Math.max(
          domainBounds.z0,
          Math.min(data.hotspot.point[1] - spanZ / 2, domainBounds.z1 - spanZ),
        );
        x1 = x0 + spanX;
        z1 = z0 + spanZ;
      }
      const scale = Math.min(
        (width - padding * 2) / (x1 - x0),
        (height - padding * 2) / (z1 - z0),
      );
      if (!Number.isFinite(scale) || scale <= 0) return;
      const offsetX = (width - (x1 - x0) * scale) / 2,
        offsetY = (height - (z1 - z0) * scale) / 2;
      const X = (value: number) => offsetX + (value - x0) * scale,
        Y = (value: number) => offsetY + (z1 - value) * scale;
      const palette = [1, 2, 3, 4, 5, 6].map((index) => {
        const color = style
          .getPropertyValue("--temperature-" + index)
          .trim()
          .replace("#", "");
        return [0, 2, 4].map((offset) =>
          parseInt(color.slice(offset, offset + 2), 16),
        );
      });
      const buffer = context.createImageData(width, height),
        span = data.maximum - data.minimum;
      // Display the stored P1 nodal interpolant. No mesh, sample or engineering value is generated.
      for (const indices of data.triangles) {
        const vertices = indices.map((index) => [
          X(data.points[index][0]),
          Y(data.points[index][1]),
        ]);
        const a = vertices[0],
          b = vertices[1],
          c = vertices[2],
          denominator =
            (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (Math.abs(denominator) < 1e-12) continue;
        const left = Math.max(
            Math.ceil(X(x0)),
            Math.floor(Math.min(a[0], b[0], c[0])),
          ),
          right = Math.min(
            Math.floor(X(x1)) - 1,
            Math.ceil(Math.max(a[0], b[0], c[0])),
          );
        const top = Math.max(
            Math.ceil(Y(z1)),
            Math.floor(Math.min(a[1], b[1], c[1])),
          ),
          bottom = Math.min(
            Math.floor(Y(z0)) - 1,
            Math.ceil(Math.max(a[1], b[1], c[1])),
          );
        for (let y = top; y <= bottom; y++)
          for (let x = left; x <= right; x++) {
            const wa =
              ((b[1] - c[1]) * (x + 0.5 - c[0]) +
                (c[0] - b[0]) * (y + 0.5 - c[1])) /
              denominator;
            const wb =
                ((c[1] - a[1]) * (x + 0.5 - c[0]) +
                  (a[0] - c[0]) * (y + 0.5 - c[1])) /
                denominator,
              wc = 1 - wa - wb;
            if (wa < -1e-8 || wb < -1e-8 || wc < -1e-8) continue;
            const value =
              wa * data.temperatures[indices[0]] +
              wb * data.temperatures[indices[1]] +
              wc * data.temperatures[indices[2]];
            const level = span
                ? Math.max(0, Math.min(5, ((value - data.minimum) / span) * 5))
                : 0,
              index = Math.min(4, Math.floor(level)),
              fraction = level - index,
              position = (y * width + x) * 4;
            for (let channel = 0; channel < 3; channel++)
              buffer.data[position + channel] = Math.round(
                palette[index][channel] * (1 - fraction) +
                  palette[index + 1][channel] * fraction,
              );
            buffer.data[position + 3] = 255;
          }
      }
      const plate = document.createElement("canvas");
      plate.width = width;
      plate.height = height;
      plate.getContext("2d")!.putImageData(buffer, 0, 0);
      context.drawImage(plate, 0, 0);
      if (data.section && data.geometry) {
        context.save();
        context.beginPath();
        context.rect(X(x0), Y(z1), (x1 - x0) * scale, (z1 - z0) * scale);
        context.clip();
        context.strokeStyle = style.getPropertyValue("--text").trim();
        context.lineWidth = 1;
        if (data.section.kind === "ground") {
          context.beginPath();
          context.moveTo(X(x0), Y(0));
          context.lineTo(X(x1), Y(0));
          context.stroke();
        }
        for (const cable of data.geometry.cables) {
          context.beginPath();
          context.arc(
            X(cable.x),
            Y(cable.z),
            cable.shape.radiusM * scale,
            0,
            Math.PI * 2,
          );
          context.strokeStyle = style.getPropertyValue("--panel").trim();
          context.lineWidth = 2;
          context.stroke();
          context.strokeStyle = style.getPropertyValue("--text").trim();
          context.lineWidth = 1;
          context.stroke();
        }
        context.setLineDash([4, 4]);
        context.lineWidth = 1;
        if (data.section.backfill) {
          const region = data.section.backfill;
          context.strokeRect(
            X(region.x - region.width / 2),
            Y(region.z + region.height / 2),
            region.width * scale,
            region.height * scale,
          );
        }
        for (const layer of data.section.soil_layers || [])
          for (const boundary of [layer.top_z, layer.bottom_z]) {
            if (boundary === 0) continue;
            context.beginPath();
            context.moveTo(X(x0), Y(boundary));
            context.lineTo(X(x1), Y(boundary));
            context.stroke();
          }
        context.restore();
      }
      context.strokeStyle = style.getPropertyValue("--control-border").trim();
      context.strokeRect(X(x0), Y(z1), (x1 - x0) * scale, (z1 - z0) * scale);
      context.fillStyle = style.getPropertyValue("--text").trim();
      context.font =
        style.getPropertyValue("--text-note").trim() + " " + style.fontFamily;
      context.textAlign = "center";
      const coordinateScale = Math.max(x1 - x0, z1 - z0) < 0.1 ? 1000 : 1;
      const coordinateUnit = coordinateScale === 1000 ? 'mm' : 'm';
      for (let index = 0; index <= 4; index++) {
        const x = x0 + ((x1 - x0) * index) / 4,
          z = z0 + ((z1 - z0) * index) / 4;
        context.fillText(formatNumber(x * coordinateScale, 2), X(x), Y(z0) + 20);
        context.fillText(formatNumber(z * coordinateScale, 2), X(x0) - 24, Y(z) + 4);
      }
      context.fillText("x / " + coordinateUnit, width / 2, height - 4);
      context.fillText("z / " + coordinateUnit, X(x0), 16);
      if (data.section?.kind === "ground" && z1 >= 0 && z0 <= 0) {
        context.textAlign = "left";
        context.fillText("地表", X(x0) + 4, Y(0) - 8);
        context.textAlign = "center";
      }
      transformed.current = [...data.samples, data.hotspot].map((sample) => ({
        sample,
        x: X(sample.point[0]),
        y: Y(sample.point[1]),
      }));
      for (const value of transformed.current) {
        if (
          value.x < X(x0) ||
          value.x > X(x1) ||
          value.y < Y(z1) ||
          value.y > Y(z0)
        )
          continue;
        context.beginPath();
        context.arc(
          value.x,
          value.y,
          value.sample.id === selected ? 5 : 3,
          0,
          Math.PI * 2,
        );
        context.strokeStyle = style.getPropertyValue("--text").trim();
        context.lineWidth = value.sample.id === selected ? 2 : 1;
        context.stroke();
      }
    }
    const observer = new ResizeObserver(paint);
    observer.observe(element);
    const themeObserver = new MutationObserver(paint);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    paint();
    return () => {
      observer.disconnect();
      themeObserver.disconnect();
    };
  }, [data, selected, zoom]);
  return (
    <figure className="temperature-figure">
      <canvas
        ref={canvas}
        className="temperature-plot"
        role="img"
        aria-label="已保存的节点温度场；取样数值见取样表"
        data-field-view={
          zoom === 1 ? "section" : zoom === 0 ? "domain" : "hotspot"
        }
        data-cable-outlines={data.geometry?.cables.length || 0}
        data-backfill-outline={!!data.section?.backfill}
        data-soil-layer-outlines={data.section?.soil_layers?.length || 0}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect(),
            x = event.clientX - rect.left,
            y = event.clientY - rect.top;
          const nearest = transformed.current.reduce<
            { sample: FieldSample; x: number; y: number } | undefined
          >(
            (found, item) =>
              !found ||
              Math.hypot(item.x - x, item.y - y) <
                Math.hypot(found.x - x, found.y - y)
                ? item
                : found,
            undefined,
          );
          if (nearest && Math.hypot(nearest.x - x, nearest.y - y) <= 10)
            onSelect(nearest.sample);
        }}
      />
      <figcaption className="temperature-legend">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <span
            key={index}
            title={
              engineeringQuantity(
                "temperature",
                data.minimum + ((data.maximum - data.minimum) * index) / 5,
                "K",
              ).complete
            }
          >
            <i
              className={"temperature-swatch temperature-swatch-" + (index + 1)}
            />
            {
              engineeringQuantity(
                "temperature",
                data.minimum + ((data.maximum - data.minimum) * index) / 5,
                "K",
              ).text
            }{" "}
            °C
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

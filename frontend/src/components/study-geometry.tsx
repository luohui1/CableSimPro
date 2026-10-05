import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  api,
  ApiError,
  array,
  message,
  numeric,
  optionalRecord,
  record,
  responseData,
  text,
} from "@/api/client";
import { methodCatalog } from "@/api/research";
import type { components } from "@/api/generated/schema";
import { CadViewport, type CadScene } from "@/features/cad";
import type { SectionSelection } from "@/features/drawing";
import { commitFields, type DomainDocument } from "@/lib/domain-fields";
import { useStudy } from "./study-provider";
export function StudyGeometry({
  document,
  sectionId,
  historical,
  selected,
  onSelect,
}: {
  document: DomainDocument;
  sectionId: string;
  historical: boolean;
  selected: SectionSelection;
  onSelect: (selection: SectionSelection) => void;
}) {
  const context = useStudy();
  const [stable, setStable] = useState({
    document,
    revision:
      context.domainDraft?.revision ?? numeric(context.workspace.revision)!,
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setStable({
          document:
            !historical && context.domainDraft
              ? commitFields(context.domainDraft)
              : document,
          revision:
            context.domainDraft?.revision ??
            numeric(context.workspace.revision)!,
        });
      } catch {
        /* Invalid draft remains editable. */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [document, context.domainDraft, historical, context.workspace.revision]);
  const preview = useQuery({
    queryKey: [
      "study-scene",
      context.study.workspace,
      stable.revision,
      sectionId,
      stable,
      historical,
    ],
    enabled: !!sectionId,
    queryFn: async ({ signal }) => {
      if (historical) throw new ApiError(501, "此固定运行未保存三维场景工件");
      let method: components["schemas"]["Method"] | undefined;
      for (const item of await methodCatalog(signal)) {
        if (item.platform_supported === false) continue;
        const cap = array(item.capabilities, "能力")
          .map((value) => record(value, "能力"))
          .find(
            (cap) =>
              cap.analysis === "geometry" &&
              cap.input_schema === "cablesim.domain/1" &&
              array(cap.artifacts, "工件声明").some(
                (value) =>
                  optionalRecord(value).type === "x-cablesim.cad-scene",
              ),
          );
        const pin = optionalRecord(item.method);
        if (cap && text(pin.release_digest)) {
          method = {
            ...pin,
            capability: text(cap.id),
          } as components["schemas"]["Method"];
          break;
        }
      }
      if (!method) throw new ApiError(501, "没有当前平台支持的敷设 CAD 能力");
      const revision = stable.revision;
      const result = await responseData(
        api.POST("/api/workspaces/{wid}/geometry-preview", {
          params: { path: { wid: context.study.workspace } },
          body: {
            expected_revision: revision,
            document: stable.document,
            method,
            parameters: { section_id: sectionId, include_exact: false },
          },
          signal,
        }),
      );
      if (
        !result ||
        result.effect !== "preview" ||
        result.base_revision !== revision
      )
        throw new ApiError(409, "场景预览与当前输入修订不一致");
      const scene = record(
        result.artifacts["x-cablesim.cad-scene"],
        "场景工件",
      );
      if (
        scene.schema !== "cablesim.cad-scene/1" ||
        scene.extrusion_axis !== "+Y" ||
        scene.brep_unit !== "mm" ||
        !text(scene.input_sha256)
      )
        throw new ApiError(502, "三维场景契约不完整");
      return scene as unknown as CadScene;
    },
    retry: false,
  });
  return (
    <CadViewport
      geometry={preview.data || null}
      state={
        !sectionId
          ? "empty"
          : preview.error
            ? "error"
            : preview.isPending
              ? "loading"
              : historical
                ? "historical"
                : "success"
      }
      error={preview.error ? message(preview.error) : undefined}
      onRetry={() => void preview.refetch()}
      selectedObject={selected ? { kind: "object", id: selected.id } : null}
      onSelectionChange={(value) => {
        const object = preview.data?.objects.find(
          (item) => item.id === value?.id,
        );
        onSelect(
          object &&
            ["cable", "enclosure", "backfill", "soil"].includes(object.kind)
            ? {
                kind: object.kind as NonNullable<SectionSelection>["kind"],
                id: object.id,
              }
            : null,
        );
      }}
    />
  );
}

import { numeric } from "@/api/client";
import { entityLabel, type DomainDocument } from "./domain-fields";
export type DomainInputChoice = {
  value: string;
  label: string;
  unit: "K*m/W" | "A";
  number: number;
};
/** Known SI facts from cablesim.domain/1; no inference from geometry or method results. */
export function domainInputChoices(
  document: DomainDocument | undefined,
): DomainInputChoice[] {
  if (!document) return [];
  const result: DomainInputChoice[] = [];
  for (const section of document.sections) {
    const material = document.materials.findIndex(
      (value) => value.id === section.medium.material,
    );
    const value =
      material >= 0
        ? numeric(document.materials[material].thermal_resistivity)
        : null;
    if (value !== null)
      result.push({
        value: "/input/materials/" + material + "/thermal_resistivity",
        label: entityLabel(document, section.id) + " · 土壤热阻率",
        unit: "K*m/W",
        number: value,
      });
  }
  document.load_cases.forEach((load, index) =>
    Object.entries(load.currents || {}).forEach(([circuit, value]) =>
      result.push({
        value:
          "/input/load_cases/" +
          index +
          "/currents/" +
          circuit.replaceAll("~", "~0").replaceAll("/", "~1"),
        label: entityLabel(document, circuit) + " · 负荷电流",
        unit: "A",
        number: value,
      }),
    ),
  );
  return result.filter(
    (item, index) =>
      result.findIndex((value) => value.value === item.value) === index,
  );
}

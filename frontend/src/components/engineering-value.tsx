import { engineeringQuantity } from "@/lib/format";
import { Tooltip } from "./ui/tooltip";

export function EngineeringValue({
  quantity,
  value,
  unit,
  withUnit = false,
}: {
  quantity: string;
  value: number | null | undefined;
  unit: string;
  withUnit?: boolean;
}) {
  const display = engineeringQuantity(quantity, value, unit);
  return (
    <Tooltip
      content={
        <>
          <div>保存完整精度：{display.original}</div>
          <div>展示完整精度：{display.complete}</div>
        </>
      }
    >
      <span className="numeric" tabIndex={0}>
        {display.text}
        {withUnit && display.unit !== "—" && (
          <span className="unit">{display.unit}</span>
        )}
      </span>
    </Tooltip>
  );
}

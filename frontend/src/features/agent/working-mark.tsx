import { Icon } from "@/components/icon";

/** 工作中的点阵（3×3 由中心向外涟漪）；完成或失败换成对应图标。 */
export function WorkingMark({ state }: { state: "working" | "done" | "error" }) {
  if (state === "done") return <Icon name="agent/approve" className="agent-mark is-done" />;
  if (state === "error") return <Icon name="status/warning" className="agent-mark is-error" />;
  return <span className="agent-lattice" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <span key={index} />)}</span>;
}


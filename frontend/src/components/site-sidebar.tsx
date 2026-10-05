import { Link } from "@tanstack/react-router";
import { Icon } from "./icon";
export function SiteSidebar({ theme }: { theme: "light" | "dark" }) {
  return (
    <>
      <Link className="module-item" to="/" search={{ theme }}>
        <Icon name="nav/recent" />
        最近打开
      </Link>
      <Link className="module-item" to="/studies" search={{ theme }}>
        <Icon name="nav/study" />
        全部研究
      </Link>
      <Link className="module-item" to="/studies" search={{ theme, kind: "simulation" }}>
        <Icon name="calc/thermal-field" />
        仿真复现
      </Link>
      <Link
        className="module-item"
        to="/types" search={{ theme }}
      >
        <Icon name="nav/cable-type" />
        型号工作区
      </Link>
    </>
  );
}

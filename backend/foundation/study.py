"""Read-only study package preparation using current, committed workspace data."""
from __future__ import annotations

from typing import Literal
from pydantic import Field
from ..schemas import Scenario
from .contracts import (AssetRef, CircularLayer, CircularRecipe, Contract,
                        Digest, Quantity, content_hash)

ADAPTER_VERSION = "study-contract/0.1.0"
Target = Literal["schema", "comsol", "aedt"]


class PreflightIssue(Contract):
    code: str
    severity: Literal["error", "warning", "info"]
    object_path: str
    message: str
    remediation: str


class StudyPackage(Contract):
    schema_version: Literal["csp-study/0.1"] = "csp-study/0.1"
    project_id: str
    scenario_revision: int = Field(ge=1, strict=True)
    adapter_version: Literal["study-contract/0.1.0"] = ADAPTER_VERSION
    target: Target
    mode: Literal["build_only"] = "build_only"
    source_kind: Literal["project_input_snapshot"] = "project_input_snapshot"
    source_sha256: Digest
    asset_lock: tuple[AssetRef, ...] = ()
    geometry_recipe: CircularRecipe
    ambient_temperature: Quantity
    conductor_limit: Quantity
    operating_current: Quantity
    conductor_r20: Quantity | None
    requested_outputs: tuple[Literal["geometry_recipe", "preflight_issues"], ...] = (
        "geometry_recipe", "preflight_issues")


class PreflightReport(Contract):
    package: StudyPackage
    package_sha256: Digest
    status: Literal["package_ready", "blocked"]
    native_model_built: Literal[False] = False
    solver_executed: Literal[False] = False
    issues: tuple[PreflightIssue, ...]


def prepare_study(snapshot: dict, target: Target = "schema") -> PreflightReport:
    """Prepare a declarative package; never create an asset release or a solver job."""
    scenario = Scenario.model_validate(snapshot["scenario"])
    roles = ("conductor", "conductor_screen", "insulation", "insulation_screen", "metallic_screen", "jacket")
    radii = scenario.cable.radii_mm()
    layers = tuple(CircularLayer(uid=f"{snapshot['id']}/cable/{role}", role=role,
                                inner_radius_m=0.0 if i == 0 else radii[i - 1] / 1000,
                                outer_radius_m=radii[i] / 1000)
                   for i, role in enumerate(roles))
    source = {k: snapshot.get(k) for k in (
        "id", "revision", "scenario", "locks", "sources", "design_basis", "product_binding")}
    package = StudyPackage(
        project_id=snapshot["id"], scenario_revision=snapshot["revision"], target=target,
        source_sha256=content_hash(source),
        # This is a 1 m section-construction recipe, not the route length.
        geometry_recipe=CircularRecipe(length_m=1.0, layers=layers),
        ambient_temperature=Quantity(value=scenario.installation.ambient_temperature_c,
                                     unit="degC", dimension="absolute_temperature").si(),
        conductor_limit=Quantity(value=scenario.cable.max_temperature_c,
                                 unit="degC", dimension="absolute_temperature").si(),
        operating_current=Quantity(value=scenario.operating_current_a, unit="A", dimension="current"),
        conductor_r20=None if scenario.cable.r20_ohm_km is None else Quantity(
            value=scenario.cable.r20_ohm_km, unit="ohm/km", dimension="linear_resistance").si(),
    )
    issues = [PreflightIssue(
        code="PROJECT_INPUTS_NOT_RELEASED_ASSETS", severity="warning", object_path="/asset_lock",
        message="输入来自当前工程快照，尚未转换为审核发布的工程资产。",
        remediation="保留项目输入来源；资产审核发布后再建立精确版本锁。"),
        PreflightIssue(code="RECIPE_NOT_NATIVE_GEOMETRY", severity="info", object_path="/geometry_recipe",
                       message="这里只生成声明式截面配方，不是 B-Rep、MPH 或 AEDT 原生文件。",
                       remediation="后续接入几何执行器并单独验收原生模型构建。")]
    if package.conductor_r20 is None:
        issues.append(PreflightIssue(
            code="R20_NOT_PROVIDED", severity="warning", object_path="/conductor_r20",
            message="未提供导体 R20；本次不填入理想估计值，也不执行载流量计算。",
            remediation="电气或热研究前核对厂家数据与适用温度。"))
    if target != "schema":
        issues.append(PreflightIssue(
            code="NATIVE_ADAPTER_NOT_CONFIGURED", severity="error", object_path="/target",
            message=f"尚未接入可验证的 {target.upper()} 原生执行器；不能声明兼容或模型已构建。",
            remediation="配置授权软件、匹配模板和模块后，执行独立 build_only 冒烟测试。"))
    return PreflightReport(package=package, package_sha256=content_hash(package),
                           status="blocked" if any(i.severity == "error" for i in issues) else "package_ready",
                           issues=tuple(issues))

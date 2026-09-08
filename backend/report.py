"""Self-contained printable HTML report; all project text is HTML-escaped."""
from html import escape
import json


def render_report(result: dict) -> str:
    s = result["input"]
    summary = result["summary"]
    selected = result["operating"] or result["rating"]
    def number(value, digits=2):
        return "无有效稳定解" if value is None else f"{value:.{digits}f}"
    warnings = "".join(f"<li>{escape(w)}</li>" for w in result["warnings"])
    phases = "".join(f"<tr><td>{phase}</td><td>{number(t)}</td><td>{number(q)}</td><td>{number(qs)}</td></tr>"
                     for phase, t, q, qs in zip("ABC", selected["temperatures_c"], selected["conductor_losses_w_m"], selected["screen_losses_w_m"]))
    layers = "".join(f"<tr><td>{escape(layer['name'])}</td><td>{number(layer['radius_mm'])}</td></tr>" for layer in result["geometry"]["layers"])
    matrix = "".join("<tr>" + "".join(f"<td>{value:.6f}</td>" for value in row) + "</tr>" for row in result["thermal"]["soil_matrix_k_m_w"])
    inputs = escape(json.dumps(s, ensure_ascii=False, indent=2))
    basis = result.get('design_basis')
    reference_section = ('<h2>06 / 本次计算的设计依据快照</h2><p>仅记录所选标准与范围检查，不代表全部条款符合性。历史计算书不会采用后续修改的依据。</p><pre>'
                         + escape(json.dumps(basis,ensure_ascii=False,indent=2)) + '</pre>') if basis else '<p>本次计算未登记独立的项目设计依据。</p>' 
    return f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>CableSimPro · 计算书</title>
<style>body{{font:15px/1.7 system-ui,sans-serif;color:#192a3d;max-width:960px;margin:40px auto;padding:0 28px}}h1{{font-size:30px}}h2{{font-size:19px;border-bottom:1px solid #ccd5df;padding-bottom:8px;margin-top:30px}}table{{border-collapse:collapse;width:100%;margin:15px 0}}td,th{{border:1px solid #ccd5df;padding:9px;text-align:left}}pre{{white-space:pre-wrap;word-break:break-word;background:#f3f5f7;padding:18px;font-size:12px}}.notice{{background:#fff6e7;border-left:4px solid #c18a23;padding:16px}}small{{color:#687889}}button{{padding:10px 18px;cursor:pointer}}@media print{{button{{display:none}}body{{margin:0;max-width:none;font-size:11px}}h2,table{{break-inside:avoid}}pre{{font-size:9px}}}}</style>
<button onclick="window.print()">打印 / 保存为 PDF</button><p><small>CABLESIMPRO / ENGINEERING DEMO</small></p>
<h1>{escape(s['name'])} · 稳态计算书</h1><p>{escape(s['description'])}</p>
<p class="notice">工程辅助演示版，不是经过认证的 IEC 60287 完整实现。请核对下列假设与原始参数，勿将结果直接用于施工定值。</p>
<h2>01 / 计算结果</h2><table><tr><th>允许稳态载流量</th><td>{number(summary['ampacity_a'])} A</td><th>限制相</th><td>{summary['limiting_phase']}</td></tr>
<tr><th>运行电流</th><td>{number(s['operating_current_a'])} A</td><th>运行最高温度</th><td>{number(summary['operating_max_temperature_c'])} °C</td></tr>
<tr><th>温度裕量</th><td>{number(summary['thermal_margin_c'])} K</td><th>运行三相线路总损耗</th><td>{number(summary['circuit_loss_kw'])} kW</td></tr></table>
<p>线路长度 {number(s['circuit_length_m'])} m；以下相别明细对应 {number(selected['current_a'])} A。运行解无效时，明细使用额定载流量工况。</p>
<table><tr><th>相别</th><th>导体温度 / °C</th><th>导体损耗 / W·m⁻¹</th><th>屏蔽损耗 / W·m⁻¹</th></tr>{phases}</table>
<h2>02 / 几何与中间量</h2><table><tr><th>层结构</th><th>外半径 / mm</th></tr>{layers}</table>
<p>R20 = {number(result['thermal']['r20_ohm_km'],6)} Ω/km；电容 = {number(result['thermal']['capacitance_nf_km'])} nF/km；每相介质损耗 = {number(result['thermal']['dielectric_loss_w_m'],6)} W/m。</p>
<p>土壤热阻矩阵 G / K·m·W⁻¹：</p><table>{matrix}</table><p>热平衡残差：{selected['residual_k']:.3e} K。</p>
<h2>03 / 模型假设与限制</h2><ul>{warnings}</ul><p>方法：同心层圆柱热阻 + 半空间镜像热源互热 + 温度相关电阻。详细推导和验证边界见仓库 docs/METHOD.md。</p>
<h2>04 / 可复算输入快照</h2><pre>{inputs}</pre>
<h2>05 / 追溯信息</h2><p>模型版本：{escape(result['model_version'])}<br>计算时间（UTC）：{escape(result['computed_at'])}<br>输入 SHA-256：<code>{result['input_sha256']}</code></p>
<p>标准范围参考：IEC 60287-1-1:2023；IEC 60287-2-1:2023。上述参考不代表本实现已获得标准符合性验证。</p>{reference_section}</html>"""

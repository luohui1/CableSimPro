"""Render saved typed results only; importing a solver here is a design violation."""
from html import escape
import json

RENDERER = 'cablesim.study-html/2'


def render(runs):
    blocks = []
    for run in runs:
        rows = []
        for case in run['output']['cases']:
            if case['status'] != 'succeeded':
                rows.append('<tr><td colspan="5">' + escape(json.dumps(case['error'], ensure_ascii=False)) + '</td></tr>')
            for r in case['results']:
                value = r.get('value') if r['status'] == 'available' else r.get('reason')
                rows.append('<tr>' + ''.join('<td>' + escape(str(v)) + '</td>' for v in
                            (case['case_id'] + ' · ' + str(r.get('case') or 'unspecified'), r['entity'], r['key'], value, r.get('unit', ''))) + '</tr>')
        blocks.append(f'<section><h2>{escape(run["snapshot"]["definition"]["title"])}</h2>'
                      f'<p>Run {escape(run["id"])} · {escape(run["status"])} · {escape(run["freshness"])}</p>'
                      '<table><thead><tr><th>采样 / 工况</th><th>对象</th><th>物理量</th><th>值</th><th>单位</th></tr></thead><tbody>'
                      + ''.join(rows) + '</tbody></table><h3>适用范围与证据</h3><pre>'
                      + escape(json.dumps({k: run['output'].get(k) for k in ('limitations', 'validation', 'executions', 'environment_digest', 'assessment', 'crosscheck')}, ensure_ascii=False, indent=2))
                      + '</pre><h3>原始输入快照</h3><pre>'
                      + escape(json.dumps(run['snapshot'], ensure_ascii=False, indent=2)) + '</pre></section>')
    return ('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>CableSimPro 研究计算书</title>'
            '<style>body{font:14px system-ui;max-width:1100px;margin:32px auto;padding:16px}table{border-collapse:collapse;width:100%}'
            'td,th{border:1px solid #ccc;padding:6px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{break-before:page}</style>'
            '<h1>CableSimPro 研究计算书</h1><p>来源为指定运行的已保存结果；导出未重新计算。验证等级仅适用于声明范围，不构成设计签审认证。</p>'
            + ''.join(blocks) + '</html>')

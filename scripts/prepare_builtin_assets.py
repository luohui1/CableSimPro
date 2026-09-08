"""Normalize the three existing CableSimPro illustrations; never contacts a provider."""
from pathlib import Path
from import_visual_asset import ROOT, prepare_asset

BUILTINS = [
    ('cable', '单芯电缆分层结构', '单芯电缆的导体、绝缘、屏蔽和护套剖切示意'),
    ('installation', '单回路直埋敷设', '三根单芯电缆与土壤剖开的三维敷设示意'),
    ('documents', '企业资料参数核对', '产品资料表、参数映射与电缆结构的核对流程示意'),
]

if __name__ == '__main__':
    for slot, title, alt in BUILTINS:
        item = prepare_asset(ROOT / 'frontend/public/engineering' / (slot + '.png'),
            slot=slot, title=title, alt=alt, provider='procedural-threejs',
            source_id='git:f0bb5cadb1fcc0a0639c14e2e8e4695a5fc2e223',
            rights_note='CableSimPro original procedural scene; source in scripts/visuals/scene.ts',
            review_note='Structural/flow illustration only. No numerical results, manufacturer mark or certification.',
            approved=True)
        print(f"{slot}: {item['bytes']} bytes, sha256={item['sha256']}")

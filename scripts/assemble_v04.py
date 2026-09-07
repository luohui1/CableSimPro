"""One-time, hash-checked source assembly on the feature branch. Not a runtime step."""
from hashlib import sha256
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
changes=json.loads((root/'scripts/v04-edits.json').read_text(encoding='utf-8'))
prepared={}
for name,change in changes.items():
    path=root/name
    if '..' in Path(name).parts or Path(name).is_absolute():raise RuntimeError('Invalid patch path')
    text=path.read_text(encoding='utf-8')
    if sha256(text.encode()).hexdigest()!=change['sha']:raise RuntimeError('Base changed: '+name)
    for start,end,replacement in reversed(change['ops']):text=text[:start]+replacement+text[end:]
    if sha256(text.encode()).hexdigest()!=change['target']:raise RuntimeError('Target mismatch: '+name)
    prepared[path]=text
for path,text in prepared.items():path.write_text(text,encoding='utf-8');print('Applied',path.relative_to(root))

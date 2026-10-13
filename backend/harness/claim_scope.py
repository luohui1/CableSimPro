"""Bind a quantity to the observed object named in its clause or section."""
import re
from .context_builder import METADATA_PROJECTIONS


IDENTITIES = {'workspace_id': 'project', 'study_id': 'study', 'run_id': 'run',
              'type_id': 'type', 'validation_id': 'validation'}


class ClaimScope:
    def __init__(self, text, observations):
        self.text = text
        names = {}
        self.parents = {}

        def visit(value, inherited):
            if isinstance(value, dict):
                if value.get('projection') in METADATA_PROJECTIONS:
                    return
                identity = {**inherited, **{key: value[key] for key in IDENTITIES
                            if isinstance(value.get(key), str)}}
                kind = value.get('kind')
                if kind in IDENTITIES.values() and isinstance(value.get('id'), str):
                    identity[next(key for key, target in IDENTITIES.items() if target == kind)] = value['id']
                # Study lists carry `id`; digest/read results carry `study_id`.
                elif value.get('id') and 'title' in value and ('driver' in value or 'latest_run_id' in value):
                    identity['study_id'] = value['id']
                if identity.get('run_id') and identity.get('study_id'):
                    self.parents[identity['run_id']] = identity['study_id']
                for field in ('name', 'title'):
                    name = value.get(field)
                    if not isinstance(name, str) or len(name) < 2:
                        continue
                    # A nested metric title does not rename its parent study.
                    own = {key: identity[key] for key in IDENTITIES if key in value}
                    if kind in IDENTITIES.values() or (value.get('id') and 'study_id' in identity):
                        own = identity
                    if own:
                        names.setdefault(name, set()).update(own.items())
                for child in value.values():
                    visit(child, identity)
            elif isinstance(value, list):
                for child in value:
                    visit(child, inherited)

        visit(observations, {})
        self.mentions = []
        for name, identities in names.items():
            by_kind = {}
            for key, identity in identities:
                by_kind.setdefault(key, set()).add(identity)
            # Duplicate names do not choose an object by accident; exact IDs can.
            # An ambiguous saved name identifies the observed set, not another
            # earlier heading. Exact IDs can still narrow that set later.
            unique = by_kind
            for match in re.finditer(re.escape(name), text):
                self.mentions.append((match.start(), match.end(), unique))
        for name, identities in names.items():
            for key, identity in identities:
                for match in re.finditer(re.escape(identity), text):
                    self.mentions.append((match.start(), match.end(), {key: {identity}}))

    def at(self, position):
        start = max(self.text.rfind(mark, 0, position) for mark in '。；;\n') + 1
        mentions = [row for row in self.mentions if start <= row[0] and row[1] <= position]
        if not mentions:
            # A heading remains in force across its following paragraphs.
            def heading(row):
                prefix=self.text[self.text.rfind('\n',0,row[0])+1:row[0]].strip()
                return prefix.startswith(('#','**','-','•')) or bool(re.match(r'^\d+[.)、]\s*',prefix))
            headings = [row for row in self.mentions if row[1] <= position and heading(row)]
            if headings:
                heading_start = self.text.rfind('\n', 0, max(headings, key=lambda row: row[0])[0]) + 1
                mentions = [row for row in headings if self.text.rfind('\n', 0, row[0]) + 1 == heading_start]
        result, by_kind = {}, {}
        for begin, end, identities in sorted(mentions):
            for key, ids in identities.items():
                by_kind.setdefault(key, []).append((begin, end, ids))
        for key, rows in by_kind.items():
            last = rows[-1]
            selected = set(last[2])
            for previous in reversed(rows[:-1]):
                between = self.text[previous[1]:last[0]]
                if previous[1] <= last[0] and (re.search(r'\d', between) or
                        not re.search(r'与|和|及|、|相比|对比|→', between)):
                    break
                selected.update(previous[2])
                last = previous
            result[key] = selected
        return result

    def matches(self, fact, position):
        identity = dict(fact)
        if identity.get('run_id') in self.parents:
            identity.setdefault('study_id', self.parents[identity['run_id']])
        return all(not identity.get(key) or identity[key] in ids
                   for key, ids in self.at(position).items())

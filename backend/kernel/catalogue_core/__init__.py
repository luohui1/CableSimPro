"""Cable Studio computing core: runs the verified plugins, holds no algorithm of its own."""
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
PLUGINS = REPO / 'plugins'


class CoreError(Exception):
    """A refusal with a stable code, a message for the engineer and the field it concerns."""

    def __init__(self, code, message, path=None):
        super().__init__(message)
        self.code, self.message, self.path = code, message, path

    def as_dict(self):
        return {'code': self.code, 'message': self.message, **({'path': self.path} if self.path else {})}

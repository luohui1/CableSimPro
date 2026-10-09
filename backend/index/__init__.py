"""One metadata index for the UI and Agent, over existing storage."""
from threading import RLock

_lock = RLock()


def get_index(research):
    from .service import Index
    with _lock:
        if not hasattr(research,'object_index'):
            research.object_index=Index(research)
        return research.object_index


def make_router(research):
    from .router import make_router as router
    return router(get_index(research))


"""Studio compatibility imports for the single, packaged catalogue runtime.

The CLI and its Studio-only modules stay here. Shared modules are registered
under this package's actual import spelling so both historical namespaces use
the canonical module objects and the same CoreError class.
"""
from importlib import import_module as _import_module
import sys as _sys

from backend.kernel.catalogue_core import CoreError, PLUGINS, REPO

_MODULES = ('basis', 'catalogue', 'designation', 'library', 'runner', 'structure',
            'tables', 'product', 'methods', 'scene', 'study', 'layouts')
__all__ = ['CoreError', 'PLUGINS', 'REPO', *_MODULES]

for _name in _MODULES:
    _module = _import_module('backend.kernel.catalogue_core.' + _name)
    globals()[_name] = _module
    _sys.modules[__name__ + '.' + _name] = _module

del _name, _module

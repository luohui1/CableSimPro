"""IEC 60287 single-core trefoil buried rating method (first-party, in-repository)."""
from .inputs import Rating
from .method import METHOD_ID, METHOD_VERSION, RatingRefused, Result, rate

__all__ = ['METHOD_ID', 'METHOD_VERSION', 'Rating', 'RatingRefused', 'Result', 'rate']

"""JSON numbers as JavaScript writes them back: JSON.stringify turns 8700.0 into 8700.

Used by the sealed-basis checks and by the record catalog builder. Only an exactly
integral float becomes the same integer; nothing is rounded, and booleans and
strings never stand in for numbers.
"""

SCHEMA = 'cablesim.basis-json-content/1'


def json_numbers(value):
    if isinstance(value, dict):
        return {key: json_numbers(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_numbers(item) for item in value]
    if type(value) is float and value.is_integer():
        return int(value)
    return value

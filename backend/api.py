from iec60287 import calculate_ampacity


def run_calculation(data):
    current = calculate_ampacity(
        area=data.get('area',240),
        thermal=data.get('thermal_resistance',0.5),
        delta=data.get('temperature_rise',65)
    )
    return {
        'ampacity': round(current,2),
        'temperature': data.get('max_temperature',90)
    }

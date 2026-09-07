import math

def calculate_ampacity(c):
    delta_t = c['max_temperature'] - c['ambient']
    r = c['resistance']
    t = c['thermal_resistance']

    current = math.sqrt(delta_t/(r*t))
    loss = current * current * r

    return {
        'ampacity_A': round(current,2),
        'temperature_C': c['max_temperature'],
        'loss_W_per_m': round(loss,3),
        'thermal_margin_C': delta_t
    }

MATERIALS = {
    "copper": {
        "resistivity": 1.724e-8,
        "thermal_conductivity": 401
    },
    "aluminum": {
        "resistivity": 2.82e-8,
        "thermal_conductivity": 237
    },
    "xlpe": {
        "thermal_resistivity": 3.5
    },
    "pvc": {
        "thermal_resistivity": 5.0
    }
}


def get_material(name):
    return MATERIALS.get(name.lower())

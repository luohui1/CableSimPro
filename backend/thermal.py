import math

class ThermalModel:
    def __init__(self, thermal_resistance=1.0):
        self.thermal_resistance = thermal_resistance

    def temperature_rise(self, loss):
        return loss * self.thermal_resistance

    def conductor_temperature(self, ambient, loss):
        return ambient + self.temperature_rise(loss)

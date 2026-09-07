from dataclasses import dataclass

@dataclass
class Cable:
    name: str
    voltage: float
    area: float
    conductor: str = 'copper'
    insulation: str = 'xlpe'
    ambient_temperature: float = 25
    max_temperature: float = 90
    thermal_resistance: float = 0.5

    def conductor_loss(self, current):
        rho = 1.724e-8 if self.conductor == 'copper' else 2.82e-8
        resistance = rho / (self.area * 1e-6)
        return current * current * resistance

from dataclasses import dataclass

@dataclass
class Cable:
    name:str
    area:float
    resistance:float
    max_temperature:float=90
    ambient_temperature:float=25
    thermal_resistance:float=1.0

    def loss(self,current):
        return current*current*self.resistance

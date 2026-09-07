from fastapi import FastAPI
from pydantic import BaseModel
from iec60287 import calculate_ampacity

app = FastAPI(title='CableSimPro Engine')

class CableInput(BaseModel):
    area: float = 240
    resistance: float = 0.000075
    thermal_resistance: float = 1.2
    ambient: float = 25
    max_temperature: float = 90

@app.get('/')
def home():
    return {'name':'CableSimPro','status':'running'}

@app.post('/calculate')
def calculate(data:CableInput):
    return calculate_ampacity(data.model_dump())

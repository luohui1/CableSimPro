"""Order-independent attribution of three declared counterfactual interventions."""
from math import factorial, isfinite


def shapley(ampacities, iec_ampacity):
    if set(ampacities) != set(range(8)) or any(not isfinite(v) or v <= 0 for v in [iec_ampacity,*ampacities.values()]):
        raise ValueError('偏差分解须有全部8个通过门禁的正载流量，不能补缺值。')
    gaps = {mask:100*(iec_ampacity/value-1) for mask,value in ampacities.items()}
    contributions = []
    for bit,key,title in [(0,'soil','土层'),(1,'duct_air','管内热阻'),(2,'losses','损耗')]:
        total = 0.
        for mask in range(8):
            if mask & (1 << bit):
                continue
            count = mask.bit_count()
            weight = factorial(count)*factorial(2-count)/factorial(3)
            total += weight*(gaps[mask | (1 << bit)]-gaps[mask])
        contributions.append({'key':key,'label':title,'percentage_points':total})
    residual = gaps[0]
    if abs(sum(r['percentage_points'] for r in contributions)+residual-gaps[7])>1e-9:
        raise ValueError('偏差分解加和不守恒。')
    dominant = max(contributions,key=lambda row:abs(row['percentage_points']))
    return {'method':'three-factor Shapley; six intervention orders averaged',
        'counterfactuals':[{'mask':mask,'soil_layers':bool(mask&1),'temperature_dependent_duct_air':bool(mask&2),
            'native_electromagnetic_losses':bool(mask&4),'fem_ampacity_a':ampacities[mask],
            'iec_over_fem_percent':gaps[mask]} for mask in range(8)],
        'contributions':contributions,'baseline_residual_percentage_points':residual,
        'updated_gap_percent':gaps[7],'historical_frozen_gap_percent':gaps[1],
        'dominant_physical_factor':dominant['key'],
        'meaning':'正贡献增加IEC相对FEM的高估；基线残差保留均匀土壤下热路/回填等效及离散差异，不强行归入三个物理因素。'}

"""Internal shared physics for reference methods, never imported by the host."""
from .network import ThermalNetwork

NetworkProperties = ThermalNetwork


def network_properties(scenario, current_a=None):
    net = ThermalNetwork(scenario)
    net.scenario = scenario
    net.total_losses_w_m = None if current_a is None else net.state(current_a)['total_losses_w_m']
    return net

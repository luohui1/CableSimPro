"""Shared test environment: the Agent key store never touches the developer's OS credential store."""
import os

os.environ.setdefault('CABLESIM_AGENT_KEY_STORE', 'memory')

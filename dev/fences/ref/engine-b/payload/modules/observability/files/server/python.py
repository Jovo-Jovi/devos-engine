"""Observability module: present because the answers turned it on."""


class ObservabilityNotConfigured(RuntimeError):
    pass


def observability():
    raise ObservabilityNotConfigured("observability is not configured yet. A later task wires the provider; see SETUP.md.")

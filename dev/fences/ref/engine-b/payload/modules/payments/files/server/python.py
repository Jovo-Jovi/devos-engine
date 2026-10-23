"""Payments module: present because the answers turned it on."""


class PaymentsNotConfigured(RuntimeError):
    pass


def payments():
    raise PaymentsNotConfigured("payments is not configured yet. A later task wires the provider; see SETUP.md.")

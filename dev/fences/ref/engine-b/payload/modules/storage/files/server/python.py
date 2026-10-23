"""Storage module: present because the answers turned it on."""


class StorageNotConfigured(RuntimeError):
    pass


def storage():
    raise StorageNotConfigured("storage is not configured yet. A later task wires the provider; see SETUP.md.")

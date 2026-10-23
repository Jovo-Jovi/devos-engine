"""Database module: present because the answers turned it on."""


class DatabaseNotConfigured(RuntimeError):
    pass


def database():
    raise DatabaseNotConfigured("database is not configured yet. A later task wires the provider; see SETUP.md.")

"""Auth module: present because the answers turned it on."""


class AuthNotConfigured(RuntimeError):
    pass


def auth():
    raise AuthNotConfigured("auth is not configured yet. A later task wires the provider; see SETUP.md.")

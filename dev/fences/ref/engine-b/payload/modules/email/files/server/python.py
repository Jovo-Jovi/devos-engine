"""Email module: present because the answers turned it on."""


class EmailNotConfigured(RuntimeError):
    pass


def email():
    raise EmailNotConfigured("email is not configured yet. A later task wires the provider; see SETUP.md.")

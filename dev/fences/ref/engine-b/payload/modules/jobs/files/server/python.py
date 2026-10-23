"""Jobs module: present because the answers turned it on."""


class JobsNotConfigured(RuntimeError):
    pass


def jobs():
    raise JobsNotConfigured("jobs is not configured yet. A later task wires the provider; see SETUP.md.")

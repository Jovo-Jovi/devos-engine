"""Search module: present because the answers turned it on."""


class SearchNotConfigured(RuntimeError):
    pass


def search():
    raise SearchNotConfigured("search is not configured yet. A later task wires the provider; see SETUP.md.")

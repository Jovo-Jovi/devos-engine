"""Product AI module: present because the answers turned it on."""


class ProductAiNotConfigured(RuntimeError):
    pass


def product_ai():
    raise ProductAiNotConfigured("product-ai is not configured yet. A later task wires the provider; see SETUP.md.")

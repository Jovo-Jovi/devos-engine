package server

import "errors"

// Product AI module: present because the answers turned it on.
var ErrProductAiNotConfigured = errors.New("product-ai is not configured yet. A later task wires the provider; see SETUP.md")

func ProductAi() error {
	return ErrProductAiNotConfigured
}

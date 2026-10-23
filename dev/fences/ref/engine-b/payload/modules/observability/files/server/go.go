package server

import "errors"

// Observability module: present because the answers turned it on.
var ErrObservabilityNotConfigured = errors.New("observability is not configured yet. A later task wires the provider; see SETUP.md")

func Observability() error {
	return ErrObservabilityNotConfigured
}

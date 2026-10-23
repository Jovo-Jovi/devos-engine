package server

import "errors"

// Payments module: present because the answers turned it on.
var ErrPaymentsNotConfigured = errors.New("payments is not configured yet. A later task wires the provider; see SETUP.md")

func Payments() error {
	return ErrPaymentsNotConfigured
}

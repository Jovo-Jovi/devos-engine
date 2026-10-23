package server

import "errors"

// Auth module: present because the answers turned it on.
var ErrAuthNotConfigured = errors.New("auth is not configured yet. A later task wires the provider; see SETUP.md")

func Auth() error {
	return ErrAuthNotConfigured
}

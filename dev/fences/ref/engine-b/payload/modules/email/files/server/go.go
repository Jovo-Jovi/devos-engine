package server

import "errors"

// Email module: present because the answers turned it on.
var ErrEmailNotConfigured = errors.New("email is not configured yet. A later task wires the provider; see SETUP.md")

func Email() error {
	return ErrEmailNotConfigured
}

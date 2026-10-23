package server

import "errors"

// Storage module: present because the answers turned it on.
var ErrStorageNotConfigured = errors.New("storage is not configured yet. A later task wires the provider; see SETUP.md")

func Storage() error {
	return ErrStorageNotConfigured
}

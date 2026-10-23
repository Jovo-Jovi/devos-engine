package server

import "errors"

// Search module: present because the answers turned it on.
var ErrSearchNotConfigured = errors.New("search is not configured yet. A later task wires the provider; see SETUP.md")

func Search() error {
	return ErrSearchNotConfigured
}

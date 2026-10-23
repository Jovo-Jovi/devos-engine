package server

import "errors"

// Database module: present because the answers turned it on.
var ErrDatabaseNotConfigured = errors.New("database is not configured yet. A later task wires the provider; see SETUP.md")

func Database() error {
	return ErrDatabaseNotConfigured
}

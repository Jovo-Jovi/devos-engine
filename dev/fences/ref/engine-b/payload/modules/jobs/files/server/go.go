package server

import "errors"

// Jobs module: present because the answers turned it on.
var ErrJobsNotConfigured = errors.New("jobs is not configured yet. A later task wires the provider; see SETUP.md")

func Jobs() error {
	return ErrJobsNotConfigured
}

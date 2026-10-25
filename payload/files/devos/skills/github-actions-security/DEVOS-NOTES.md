# DEV_OS notes on GitHub's secure use reference

Written by DEV_OS after reading the page whole (2026-10-25). Read this before `secure-use.md`. These notes are DEV_OS's
own text, not part of the page (`ATTRIBUTION.md`).

## Reading the source

The page is the source of docs.github.com, written in Liquid templates:

- `{% data variables.product.prodname_actions %}` means "GitHub Actions"; `prodname_dotcom`, `github` and
  `company_short` mean "GitHub"; `prodname_dependabot` means "Dependabot"; `prodname_codeql` means "CodeQL";
  `prodname_code_scanning` means "code scanning".
- A `{% data reusables... %}` line stands for text included from another file of GitHub's docs. That text is not
  here; do not guess it.
- In `{% ifversion %}` blocks, read the parts for `fpt` and `ghec` (GitHub.com).
- `AUTOTITLE` links point to other pages of GitHub's docs. Do not fetch them.

## Applying it

- **The project's own workflows only.** DEV_OS's workflows (`.github/workflows/devos-*`) are method files: a product
  task never changes them (PR-28).
- **Pin every action to a full commit SHA** and give `GITHUB_TOKEN` the least permissions, as the page says.
- **Untrusted input goes through an environment variable**, never straight into a `run:` script.
- **Repository and organisation settings** (Dependabot, code scanning, Scorecards, runner groups, the setting that
  lets Actions create pull requests) are the owner's to choose: propose them in the report, never change them from a
  task. DEV_OS's cycle opens pull requests on purpose, with its own token.
- **Secrets** are never echoed or written to a file, in line with the method.
- **Who wins.** The fence, `docs/DECISIONS.md` and the method win over the page.

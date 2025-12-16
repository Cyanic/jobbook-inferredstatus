# Repository Guidelines

## Project Structure & Module Organization
- Keep canonical datasets in `data/`; treat CSVs as read-only inputs and avoid committing derived outputs unless they are small, versioned samples.
- Add reusable code under `src/` (create if missing) with clear module boundaries; place quick experiments or EDA in `notebooks/` and one-off scripts in `scripts/`.
- Store tests alongside code in `tests/` mirroring the module layout; fixtures and sample data belong in `tests/fixtures/`.

## Build, Test, and Development Commands
- Create an isolated environment before adding dependencies: `python -m venv .venv && source .venv/bin/activate` (or platform equivalent).
- Install project requirements once a `requirements.txt` or `pyproject.toml` exists: `pip install -r requirements.txt` or `pip install -e .`.
- Run unit tests with `pytest` from the repo root; add `-q` for faster feedback and `--maxfail=1` when iterating.
- Use `python -m pip install -r dev-requirements.txt` (if present) for lint/format tools.

## Coding Style & Naming Conventions
- Default to PEP 8 with Black-compatible formatting (4-space indent, 88–100 char lines); prefer `snake_case` for variables/functions, `PascalCase` for classes, and `UPPER_SNAKE_CASE` for constants.
- Organize modules with explicit `__all__` when exporting public APIs; keep functions small and pure where possible.
- Document non-obvious logic with docstrings and short inline comments; prefer type hints on public functions.

## Testing Guidelines
- Cover new modules with `pytest`; name files `test_<module>.py` and functions `test_<behavior>`.
- Include regression cases for data edge conditions (e.g., missing fields, unexpected job status order) and add sample inputs in `tests/fixtures/`.
- If adding data transforms, assert both schema (columns/types) and key invariants (ordering, deduplication).

## Commit & Pull Request Guidelines
- Use clear, present-tense commit messages (e.g., `add status ordering helper`, `document data layout`); group related changes per commit.
- PRs should describe intent, scope, and testing performed; link issues/tasks when applicable.
- Include screenshots or CLI output only when they materially aid review (e.g., before/after metrics, test runs).

## Data Handling & Security
- Do not commit secrets or proprietary data beyond the approved CSVs; prefer environment variables for credentials.
- When sharing slices of the dataset, anonymize sensitive fields and limit rows to the minimum needed for reproduction.

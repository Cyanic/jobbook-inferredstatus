# Job Status Inference

Script to infer DWR job statuses from historical activity, using the canonical ordering in `data/job_status_order.csv`.

## Prerequisites
- Node.js (18+ recommended)

## Usage
```sh
node scripts/inferStatus.js --input <path/to/input.csv> [--output-dir <dir>]
```
- `--input` (required): CSV containing DWR rows (e.g., `data/data-subset-1000rows-clean2.csv`).
- `--output-dir` (optional): Target directory for the output CSV; defaults to `output/`.

Output is written to `<output-dir>/<input-filename>` with all original columns plus `iStatus`.

## Algorithm Notes
- Groups rows by `job_number`.
- Sorts each group by `date`, then `dwrNumber`, then original order.
- Status ordering is read from `data/job_status_order.csv`.
- Allows regressions; `iStatus` updates to any known status observed.
- Unknown or missing statuses carry forward the last inferred status; initial fallback is `Estimating`.
- Creates `output/` automatically if it does not exist.

## Example
```sh
node scripts/inferStatus.js --input data/data-subset-1000rows-clean2.csv
# -> output/data-subset-1000rows-clean2.csv
```

'use strict';

const fs = require('fs');
const path = require('path');

const JOB_ID_FIELD = 'job_number';
const STATUS_FIELD = 'job_status_at_dwr_create';
const DATE_FIELD = 'date';
const DWR_FIELD = 'dwrNumber';
const ORDER_FILE = path.join(__dirname, '..', 'data', 'job_status_order.csv');
const DEFAULT_OUTPUT_DIR = path.join(__dirname, '..', 'output');
const DEFAULT_FALLBACK_STATUS = 'Estimating';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' || arg === '-i') {
      args.input = argv[i + 1];
      i += 1;
    } else if (arg === '--output-dir' || arg === '-o') {
      args.outputDir = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function parseCSV(content) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      // Ignore
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function stringifyValue(value) {
  const needsQuote = /[",\n\r]/.test(value);
  if (!needsQuote) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function loadStatusOrder() {
  const orderContent = fs.readFileSync(ORDER_FILE, 'utf8');
  const [header, ...rows] = parseCSV(orderContent);
  const statusIdx = header.indexOf('job_status');
  if (statusIdx === -1) {
    throw new Error('job_status column not found in job_status_order.csv');
  }
  return rows
    .filter((r) => r.length > statusIdx && r[statusIdx].trim().length > 0)
    .map((r) => r[statusIdx].trim());
}

function buildStatusSet(orderList) {
  const set = new Set(orderList);
  if (!set.has(DEFAULT_FALLBACK_STATUS) && orderList.length > 0) {
    set.add(orderList[0]);
  }
  return set;
}

function safeDate(value) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

function inferStatuses(rows, statusSet) {
  const assignments = new Map();
  const groups = new Map();

  rows.forEach((row, index) => {
    const jobId = row[JOB_ID_FIELD];
    if (!groups.has(jobId)) groups.set(jobId, []);
    groups.get(jobId).push({ row, index });
  });

  groups.forEach((entries) => {
    let current = statusSet.has(DEFAULT_FALLBACK_STATUS)
      ? DEFAULT_FALLBACK_STATUS
      : statusSet.values().next().value;

    entries.sort((a, b) => {
      const dateA = safeDate(a.row[DATE_FIELD]);
      const dateB = safeDate(b.row[DATE_FIELD]);
      if (dateA && dateB && dateA.getTime() !== dateB.getTime()) {
        return dateA - dateB;
      }
      const dwrA = a.row[DWR_FIELD] || '';
      const dwrB = b.row[DWR_FIELD] || '';
      if (dwrA !== dwrB) return dwrA.localeCompare(dwrB);
      return a.index - b.index;
    });

    entries.forEach(({ row, index }) => {
      const status = row[STATUS_FIELD];
      if (statusSet.has(status)) {
        current = status;
      }
      assignments.set(index, current);
    });
  });

  return assignments;
}

function readInputFile(inputPath) {
  const content = fs.readFileSync(inputPath, 'utf8');
  const parsed = parseCSV(content);
  const [headerRow, ...dataRows] = parsed;
  const headers = headerRow;
  const rows = dataRows.map((values) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] ?? '';
    });
    return obj;
  });
  return { headers, rows };
}

function writeOutput(headers, rows, assignments, outputPath) {
  const outputHeaders = [...headers, 'iStatus'];
  const lines = [outputHeaders.map(stringifyValue).join(',')];

  rows.forEach((row, index) => {
    const values = outputHeaders.map((h) => {
      if (h === 'iStatus') return assignments.get(index) ?? '';
      return row[h] ?? '';
    });
    lines.push(values.map(String).map(stringifyValue).join(','));
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.error('Usage: node scripts/inferStatus.js --input <path/to/input.csv> [--output-dir <dir>]');
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), args.input);
  const outputDir = args.outputDir
    ? path.resolve(process.cwd(), args.outputDir)
    : DEFAULT_OUTPUT_DIR;
  const outputPath = path.join(outputDir, path.basename(inputPath));

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const orderList = loadStatusOrder();
  const statusSet = buildStatusSet(orderList);
  const { headers, rows } = readInputFile(inputPath);
  const assignments = inferStatuses(rows, statusSet);
  writeOutput(headers, rows, assignments, outputPath);

  console.log(`Wrote inferred statuses to ${outputPath}`);
}

if (require.main === module) {
  main();
}

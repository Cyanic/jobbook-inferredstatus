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
const DESCRIPTION_FIELD = 'timeCard.description';
const ROLE_FIELD = 'labour.name';

// Keywords mapped to the status they most strongly suggest. Order must match
// the canonical order to preserve the monotone progression during inference.
const STATUS_KEYWORDS = {
  Estimating: [
    /estimate/,
    /proposal/,
    /bid/,
    /pricing/,
    /rfp/,
  ],
  'Job Setup': [/setup/, /conversion/, /onboard/, /kickoff/],
  'Ready to Schedule': [/ready to schedule/, /project conversion/, /mobilize/],
  Scheduled: [/schedule/, /scheduled/, /booking/, /calendar/],
  'On Hold': [/hold/, /paused?/],
  'Field Work in Progress': [
    /travel/,
    /site/,
    /field/,
    /collect/,
    /survey/,
    /scan/,
    /locat/,
    /inspection/,
    /safety/,
  ],
  'Ready to Draft': [
    /processing/,
    /register/,
    /ortho/,
    /clean/,
    /qc/,
    /convert/,
  ],
  Drafting: [/draft/, /survbase/, /cad/, /markup/, /dwg/, /plan/],
  'Ready to Check': [/ready to check/, /package ready/, /awaiting check/],
  Checking: [/check/, /qa/, /review/],
  'Final Submission Sent': [
    /submission/,
    /deliver/,
    /sent/,
    /deliverable/,
    /package issued/,
  ],
  'Ready to Invoice': [/ready to invoice/, /billing/, /billable/],
  Invoiced: [/invoic/],
  Complete: [
    /project complete/,
    /job complete/,
    /closeout/,
    /final invoice/,
    /finalized/,
  ],
};

// Role → status affinity provides a strong signal when job roles correlate
// tightly to a stage. The weights here are larger than keyword scores to
// prioritize role-based inference when available.
const ROLE_STATUS_MAP = [
  { match: /estimating|proposal|bd|business development/i, statuses: ['Estimating', 'Job Setup'], weight: 3 },
  { match: /administrator|admin/i, statuses: ['Job Setup', 'Ready to Schedule'], weight: 2.5 },
  { match: /survey|field|technician|technologist/i, statuses: ['Field Work in Progress'], weight: 3 },
  { match: /data processing|processing|lidar/i, statuses: ['Ready to Draft', 'Drafting'], weight: 3 },
  { match: /cad|draft|designer|survbase|markup/i, statuses: ['Drafting', 'Ready to Check'], weight: 3 },
  { match: /manager|project manager|pm/i, statuses: ['Checking', 'Final Submission Sent'], weight: 2.5 },
  { match: /accounting|billing|finance|ap|ar|invoice/i, statuses: ['Ready to Invoice', 'Invoiced'], weight: 3 },
];

// Upper bounds for how far a row should advance based on the labour role.
// This prevents field roles from being marked Complete solely due to wording.
const ROLE_MAX_STATUS = [
  { match: /survey|field|technician|technologist/i, maxStatus: 'Field Work in Progress' },
  { match: /data processing|processing|lidar/i, maxStatus: 'Drafting' },
  { match: /cad|draft|designer|survbase|markup/i, maxStatus: 'Drafting' },
  { match: /manager|project manager|pm/i, maxStatus: 'Final Submission Sent' },
];

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

function buildStatusIndex(orderList) {
  const index = new Map();
  orderList.forEach((status, i) => index.set(status, i));
  return index;
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

function isEmptyRow(row) {
  return Object.values(row).every((value) => value === '' || value === undefined);
}

function combineRowText(row) {
  const parts = [
    row[STATUS_FIELD],
    row[ROLE_FIELD],
    row[DESCRIPTION_FIELD],
    typeof row.additionalFields === 'string' ? row.additionalFields : '',
  ];
  return parts
    .filter((p) => typeof p === 'string' && p.trim().length > 0)
    .join(' ')
    .toLowerCase();
}

function scoreStatuses(row, statusOrder, statusIndex) {
  const scores = new Map();
  statusOrder.forEach((status) => scores.set(status, 0));

  const text = combineRowText(row);
  Object.entries(STATUS_KEYWORDS).forEach(([status, patterns]) => {
    if (!statusIndex.has(status)) return;
    let score = 0;
    patterns.forEach((pattern) => {
      if (pattern.test(text)) score += 1;
    });
    if (score > 0) {
      scores.set(status, scores.get(status) + score);
    }
  });

  ROLE_STATUS_MAP.forEach((hint) => {
    if (!hint.match.test(row[ROLE_FIELD] || '')) return;
    hint.statuses.forEach((status) => {
      if (!statusIndex.has(status)) return;
      scores.set(status, scores.get(status) + hint.weight);
    });
  });

  return scores;
}

function roleCapIndex(row, statusIndex, floorIdx) {
  let capIdx = Infinity;
  ROLE_MAX_STATUS.forEach((cap) => {
    if (!cap.match.test(row[ROLE_FIELD] || '')) return;
    const idx = statusIndex.get(cap.maxStatus);
    if (typeof idx === 'number') capIdx = Math.min(capIdx, idx);
  });
  if (capIdx === Infinity) return floorIdx;
  return Math.max(floorIdx, capIdx);
}

function pickStatusFromSignals(row, floorIdx, capIdx, statusOrder, statusIndex) {
  const scores = scoreStatuses(row, statusOrder, statusIndex);
  let best = null;

  scores.forEach((score, status) => {
    const idx = statusIndex.get(status);
    if (idx < floorIdx || idx > capIdx) return;
    if (score <= 0) return;
    if (!best || score > best.score || (score === best.score && idx > best.idx)) {
      best = { idx, status, score };
    }
  });

  return best ? best.idx : null;
}

function inferStatuses(rows, statusSet, statusOrder, statusIndex) {
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
    let currentIdx = statusIndex.get(current) ?? 0;

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
      if (isEmptyRow(row)) {
        assignments.set(index, '');
        return;
      }

      const capIdx = roleCapIndex(row, statusIndex, currentIdx);
      const status = row[STATUS_FIELD];
      const explicitIdx = statusIndex.get(status);
      if (typeof explicitIdx === 'number') {
        currentIdx = Math.min(Math.max(currentIdx, explicitIdx), capIdx);
      }

      const signalIdx = pickStatusFromSignals(row, currentIdx, capIdx, statusOrder, statusIndex);
      if (signalIdx !== null) {
        currentIdx = Math.min(Math.max(currentIdx, signalIdx), capIdx);
      }

      current = statusOrder[currentIdx] || current;
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
  const statusIndex = buildStatusIndex(orderList);
  const { headers, rows } = readInputFile(inputPath);
  const assignments = inferStatuses(rows, statusSet, orderList, statusIndex);
  writeOutput(headers, rows, assignments, outputPath);

  console.log(`Wrote inferred statuses to ${outputPath}`);
}

if (require.main === module) {
  main();
}

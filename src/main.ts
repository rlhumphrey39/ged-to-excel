import { CHATGPT_PROMPT } from './core/prompt';
import { ENCODING_OVERRIDES } from './core/encoding';
import type { ConversionSummary, Stage } from './core/types';
import type { WorkerRequest, WorkerResponse } from './worker';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const dropZone = $<HTMLElement>('drop-zone');
const fileInput = $<HTMLInputElement>('file-input');
const chooseButton = $<HTMLButtonElement>('choose-button');
const progressArea = $<HTMLElement>('progress-area');
const progressBar = $<HTMLProgressElement>('progress-bar');
const progressText = $<HTMLElement>('progress-text');
const errorArea = $<HTMLElement>('error-area');
const errorMessage = $<HTMLElement>('error-message');
const errorList = $<HTMLUListElement>('error-list');
const errorDetails = $<HTMLDetailsElement>('error-details');
const errorTechnical = $<HTMLElement>('error-technical');
const resultArea = $<HTMLElement>('result-area');
const downloadButton = $<HTMLButtonElement>('download-button');
const summaryList = $<HTMLUListElement>('summary-list');
const reportText = $<HTMLElement>('report-text');
const saveReport = $<HTMLButtonElement>('save-report');
const promptText = $<HTMLTextAreaElement>('prompt-text');
const copyButton = $<HTMLButtonElement>('copy-button');
const encodingSelect = $<HTMLSelectElement>('encoding-select');

const STAGE_TEXT: Record<Stage, string> = {
  reading: 'Reading your file…',
  parsing: 'Going through your family tree…',
  checking: 'Checking everything…',
  writing: 'Creating the Excel workbook…',
};

promptText.value = CHATGPT_PROMPT;
for (const o of ENCODING_OVERRIDES) {
  const opt = document.createElement('option');
  opt.value = o.value;
  opt.textContent = o.label;
  encodingSelect.appendChild(opt);
}

let worker: Worker | null = null;
let workbookBlob: Blob | null = null;
let reportBlob: Blob | null = null;
let baseName = 'family-tree';

function baseNameOf(name: string): string {
  const i = name.lastIndexOf('.');
  return (i > 0 ? name.slice(0, i) : name) || 'family-tree';
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function resetView() {
  errorArea.hidden = true;
  resultArea.hidden = true;
  errorList.replaceChildren();
  errorTechnical.textContent = '';
  errorDetails.hidden = true;
  summaryList.replaceChildren();
  reportText.textContent = '';
  workbookBlob = null;
  reportBlob = null;
}

function showError(message: string, problems: string[] = [], technical = '') {
  progressArea.hidden = true;
  resultArea.hidden = true;
  errorArea.hidden = false;
  errorMessage.textContent = message;
  errorList.replaceChildren(
    ...problems.map((p) => {
      const li = document.createElement('li');
      li.textContent = p;
      return li;
    }),
  );
  errorTechnical.textContent = technical;
  errorDetails.hidden = technical === '';
  chooseButton.disabled = false;
}

const fmt = (n: number) => n.toLocaleString();

function showSummary(s: ConversionSummary) {
  const warningsCount = s.warnings.length;
  const lines = [
    `File: ${s.fileName}`,
    `People: ${fmt(s.people)}`,
    `Families: ${fmt(s.families)}`,
    `Facts recorded: ${fmt(s.factRows)}`,
    `Family connections: ${fmt(s.relationshipRows)}`,
    `Other records: ${fmt(s.otherRecords)}`,
    warningsCount === 0
      ? 'Nothing unusual was found in the file.'
      : `Things worth knowing about the file: ${fmt(warningsCount)} (see More details)`,
  ];
  summaryList.replaceChildren(
    ...lines.map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }),
  );
}

function startConversion(file: File) {
  resetView();
  baseName = baseNameOf(file.name);
  progressArea.hidden = false;
  progressBar.value = 0;
  progressText.textContent = STAGE_TEXT.reading;
  chooseButton.disabled = true;

  worker?.terminate();
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      progressBar.value = msg.percent;
      progressText.textContent = STAGE_TEXT[msg.stage];
      return;
    }
    worker?.terminate();
    worker = null;
    chooseButton.disabled = false;
    if (msg.type === 'error') {
      // Technical details stay on the page; nothing from the file is logged.
      console.error('Conversion failed.');
      showError(msg.message, [], msg.technical);
      return;
    }
    const result = msg.result;
    reportBlob = new Blob([result.report], { type: 'text/plain;charset=utf-8' });
    reportText.textContent = result.report;
    if (!result.ok) {
      console.warn(`Conversion stopped by ${result.errors.length} check(s).`);
      showError(
        'Something did not add up while converting this file, so the workbook was not created.',
        result.errors,
        result.report,
      );
      return;
    }
    workbookBlob = new Blob([result.workbook as Uint8Array<ArrayBuffer>], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    progressBar.value = 100;
    progressText.textContent = 'Done. Your workbook is ready.';
    showSummary(result.summary);
    resultArea.hidden = false;
    downloadButton.focus();
  };
  worker.onerror = (e) => {
    e.preventDefault();
    worker?.terminate();
    worker = null;
    console.error('Conversion worker error.');
    showError('Something went wrong while converting this file, so the workbook was not created.', [], e.message || '');
  };
  const req: WorkerRequest = { type: 'convert', file, encodingOverride: encodingSelect.value };
  worker.postMessage(req);
}

chooseButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) startConversion(f);
  fileInput.value = ''; // choosing the same file again re-runs
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragging');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragging');
  const f = e.dataTransfer?.files?.[0];
  if (f) startConversion(f);
});
// Dropping a file anywhere else should not navigate away from the page.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

downloadButton.addEventListener('click', () => {
  if (workbookBlob) download(workbookBlob, `${baseName}-workbook.xlsx`);
});
saveReport.addEventListener('click', () => {
  if (reportBlob) download(reportBlob, `${baseName}-conversion-report.txt`);
});

copyButton.addEventListener('click', async () => {
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(CHATGPT_PROMPT);
      copied = true;
    }
  } catch {
    copied = false;
  }
  if (!copied) {
    promptText.focus();
    promptText.select();
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
  }
  copyButton.textContent = copied ? 'Copied' : 'Press Ctrl+C (or Cmd+C) to copy';
  setTimeout(() => (copyButton.textContent = 'Copy'), 2000);
});

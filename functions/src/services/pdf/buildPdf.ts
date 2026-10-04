import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import type { HospitalReferralView, HospitalVisitView } from '../../shared/contracts';
import type { QSummaryContent } from '../../shared/types';
import { DANGER_SIGN_LABELS } from '../../shared/types';
import type { PatientExportData } from '../referralView';
import { manilaDateTime } from '../time';

// ── text sanitising (StandardFonts only support WinAnsi) ────────────────────
const REPLACEMENTS: [RegExp, string][] = [
  [/→/g, '->'],
  [/←/g, '<-'],
  [/[·•]/g, '-'],
  [/≥/g, '>='],
  [/≤/g, '<='],
  [/[—–]/g, '-'],
  [/[‘’]/g, "'"],
  [/[“”]/g, '"'],
  [/…/g, '...'],
];

/** Converts to WinAnsi-safe single-line text. */
export function sanitizePdfText(input: unknown): string {
  let s = input == null ? '' : String(input);
  for (const [re, rep] of REPLACEMENTS) s = s.replace(re, rep);
  s = s.replace(/[\r\n\t]+/g, ' ');
  return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

export interface BuildPdfInput {
  view: HospitalReferralView | null;
  patientOnly?: PatientExportData;
  generatedAtMillis: number;
}

// ── layout constants ────────────────────────────────────────────────────────
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 40;
const TOP = PAGE_H - 48;
const BOTTOM = 64;
const CONTENT_W = PAGE_W - 2 * MARGIN_X;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.4, 0.4, 0.45);
const ACCENT = rgb(0.55, 0.12, 0.3);
const RULE = rgb(0.8, 0.8, 0.82);
const NOT_DOCUMENTED = 'Not documented';

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const clean = sanitizePdfText(text);
  if (!clean) return [''];
  const words = clean.split(' ');
  const lines: string[] = [];
  let line = '';
  const push = (w: string) => {
    // Hard-split words that are wider than the column.
    let rest = w;
    while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
      let i = rest.length - 1;
      while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > maxWidth) i--;
      lines.push(rest.slice(0, i));
      rest = rest.slice(i);
    }
    return rest;
  };
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = push(word);
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

class Layout {
  page!: PDFPage;
  y = TOP;
  /** Called after a page break (e.g. to repeat a table header). */
  onNewPage: (() => void) | null = null;

  constructor(
    private readonly doc: PDFDocument,
    readonly fonts: Fonts,
  ) {
    this.newPage();
  }

  newPage(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = TOP;
    const cb = this.onNewPage;
    if (cb) cb();
  }

  ensure(height: number): void {
    if (this.y - height < BOTTOM) this.newPage();
  }

  space(h: number): void {
    this.y -= h;
  }

  text(str: string, opts: { size?: number; bold?: boolean; color?: RGB; indent?: number; width?: number } = {}): void {
    const size = opts.size ?? 9.5;
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const indent = opts.indent ?? 0;
    const width = opts.width ?? CONTENT_W - indent;
    const lineH = size * 1.3;
    for (const raw of String(str ?? '').split(/\r?\n/)) {
      for (const line of wrapText(raw, font, size, width)) {
        this.ensure(lineH);
        this.page.drawText(line, { x: MARGIN_X + indent, y: this.y - size, size, font, color: opts.color ?? INK });
        this.y -= lineH;
      }
    }
  }

  heading(str: string): void {
    this.ensure(30);
    this.space(8);
    this.text(str, { size: 12, bold: true, color: ACCENT });
    this.page.drawLine({ start: { x: MARGIN_X, y: this.y + 2 }, end: { x: PAGE_W - MARGIN_X, y: this.y + 2 }, thickness: 0.6, color: RULE });
    this.space(4);
  }

  keyValues(rows: [string, string][]): void {
    const labelW = 130;
    for (const [k, v] of rows) {
      const size = 9.5;
      const lines = wrapText(v || NOT_DOCUMENTED, this.fonts.regular, size, CONTENT_W - labelW);
      const h = lines.length * size * 1.3;
      this.ensure(h);
      this.page.drawText(sanitizePdfText(k), { x: MARGIN_X, y: this.y - size, size, font: this.fonts.bold, color: MUTED });
      lines.forEach((l, i) => this.page.drawText(l, { x: MARGIN_X + labelW, y: this.y - size - i * size * 1.3, size, font: this.fonts.regular, color: INK }));
      this.y -= h;
    }
  }

  bullets(items: string[], emptyText = NOT_DOCUMENTED): void {
    if (!items.length) {
      this.text(emptyText, { color: MUTED, indent: 8 });
      return;
    }
    for (const item of items) this.text(`- ${item}`, { indent: 8 });
  }
}

// ── visit table ─────────────────────────────────────────────────────────────
const COLUMNS: { title: string; width: number; value: (v: HospitalVisitView) => string }[] = [
  { title: 'Date', width: 50, value: (v) => v.visitDate },
  { title: 'GA', width: 50, value: (v) => v.gestationalAge },
  { title: 'BP', width: 42, value: (v) => `${v.bpSystolic}/${v.bpDiastolic}` },
  { title: 'Wt kg', width: 30, value: (v) => String(v.weightKg ?? '-') },
  { title: 'FHR', width: 28, value: (v) => (v.fhr == null ? '-' : String(v.fhr)) },
  { title: 'Glu', width: 30, value: (v) => (v.glucoseMgDl == null ? '-' : String(v.glucoseMgDl)) },
  { title: 'FH cm', width: 28, value: (v) => (v.fundalHeightCm == null ? '-' : String(v.fundalHeightCm)) },
  { title: 'Urine P/G', width: 44, value: (v) => `${urine(v.urineProtein)}/${urine(v.urineGlucose)}` },
  {
    title: 'Danger signs',
    width: 72,
    value: (v) => {
      const s = (Object.keys(DANGER_SIGN_LABELS) as (keyof typeof DANGER_SIGN_LABELS)[]).filter((k) => v.dangerSigns?.[k]).map((k) => DANGER_SIGN_LABELS[k]);
      return s.length ? s.join(', ') : 'None';
    },
  },
  { title: 'Medications', width: 70, value: (v) => (v.medications?.length ? v.medications.join(', ') : '-') },
  { title: 'Notes / recorded by', width: 71, value: (v) => [v.notes, v.recordedBy ? `(${v.recordedBy})` : ''].filter(Boolean).join(' ') || '-' },
];

function urine(v: string): string {
  return v === 'not_done' ? 'n/d' : v;
}

function drawVisitTable(L: Layout, visitsNewestFirst: HospitalVisitView[]): void {
  const size = 7.5;
  const lineH = size * 1.25;
  const pad = 3;
  const drawHeader = () => {
    const h = lineH + 2 * pad;
    L.page.drawRectangle({ x: MARGIN_X, y: L.y - h, width: CONTENT_W, height: h, color: rgb(0.93, 0.9, 0.92) });
    let x = MARGIN_X;
    for (const c of COLUMNS) {
      L.page.drawText(sanitizePdfText(c.title), { x: x + 2, y: L.y - pad - size, size, font: L.fonts.bold, color: INK });
      x += c.width;
    }
    L.y -= h;
  };
  if (!visitsNewestFirst.length) {
    L.text('No prenatal visits documented.', { color: MUTED });
    return;
  }
  L.ensure(60);
  drawHeader();
  L.onNewPage = drawHeader;
  for (const v of visitsNewestFirst) {
    const cells = COLUMNS.map((c) => wrapText(c.value(v), L.fonts.regular, size, c.width - 4));
    const rowH = Math.max(...cells.map((c) => c.length)) * lineH + 2 * pad;
    L.ensure(rowH);
    let x = MARGIN_X;
    cells.forEach((lines, ci) => {
      lines.forEach((line, li) => L.page.drawText(line, { x: x + 2, y: L.y - pad - size - li * lineH, size, font: L.fonts.regular, color: INK }));
      x += COLUMNS[ci].width;
    });
    L.y -= rowH;
    L.page.drawLine({ start: { x: MARGIN_X, y: L.y }, end: { x: PAGE_W - MARGIN_X, y: L.y }, thickness: 0.4, color: RULE });
  }
  L.onNewPage = null;
}

// ── charts (vector, pdf-lib primitives only) ────────────────────────────────
interface Series {
  label: string;
  color: RGB;
  values: (number | null | undefined)[];
  dashed?: boolean;
  marker: 'circle' | 'square';
}

function drawChart(L: Layout, x: number, yTop: number, w: number, h: number, title: string, unit: string, labels: string[], series: Series[]): void {
  const { page, fonts } = L;
  page.drawText(sanitizePdfText(`${title} (${unit})`), { x, y: yTop - 10, size: 9, font: fonts.bold, color: INK });
  // legend
  let lx = x + w;
  for (const s of [...series].reverse()) {
    const tw = fonts.regular.widthOfTextAtSize(s.label, 7);
    lx -= tw + 22;
    page.drawLine({ start: { x: lx, y: yTop - 7 }, end: { x: lx + 14, y: yTop - 7 }, thickness: 1.4, color: s.color, dashArray: s.dashed ? [3, 2] : undefined });
    page.drawText(s.label, { x: lx + 17, y: yTop - 9.5, size: 7, font: fonts.regular, color: MUTED });
  }
  const px = x + 30;
  const pw = w - 38;
  const pyBottom = yTop - h + 16;
  const ph = h - 36;
  page.drawRectangle({ x: px, y: pyBottom, width: pw, height: ph, borderColor: RULE, borderWidth: 0.6 });

  const all = series.flatMap((s) => s.values).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!all.length) {
    page.drawText(NOT_DOCUMENTED, { x: px + 8, y: pyBottom + ph / 2 - 3, size: 8, font: fonts.regular, color: MUTED });
    return;
  }
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max) {
    min -= 5;
    max += 5;
  }
  const padV = (max - min) * 0.1;
  min = Math.floor(min - padV);
  max = Math.ceil(max + padV);
  const n = labels.length;
  const xAt = (i: number) => (n <= 1 ? px + pw / 2 : px + 6 + (i * (pw - 12)) / (n - 1));
  const yAt = (v: number) => pyBottom + ((v - min) / (max - min)) * ph;

  page.drawText(String(max), { x: x, y: pyBottom + ph - 6, size: 7, font: fonts.regular, color: MUTED });
  page.drawText(String(min), { x: x, y: pyBottom, size: 7, font: fonts.regular, color: MUTED });
  if (n >= 1) {
    page.drawText(sanitizePdfText(labels[0].slice(5)), { x: xAt(0) - 8, y: pyBottom - 10, size: 6.5, font: fonts.regular, color: MUTED });
    if (n > 1) page.drawText(sanitizePdfText(labels[n - 1].slice(5)), { x: xAt(n - 1) - 12, y: pyBottom - 10, size: 6.5, font: fonts.regular, color: MUTED });
  }

  for (const s of series) {
    let prev: { x: number; y: number } | null = null;
    s.values.forEach((v, i) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        prev = null;
        return;
      }
      const pt = { x: xAt(i), y: yAt(v) };
      if (prev) page.drawLine({ start: prev, end: pt, thickness: 1.4, color: s.color, dashArray: s.dashed ? [3, 2] : undefined });
      if (s.marker === 'circle') page.drawCircle({ x: pt.x, y: pt.y, size: 2.2, color: s.color });
      else page.drawRectangle({ x: pt.x - 2, y: pt.y - 2, width: 4, height: 4, color: s.color });
      prev = pt;
    });
  }
}

function drawCharts(L: Layout, visitsNewestFirst: HospitalVisitView[]): void {
  const asc = [...visitsNewestFirst].reverse();
  const labels = asc.map((v) => v.visitDate);
  const chartW = (CONTENT_W - 15) / 2;
  const chartH = 130;
  const charts: [string, string, Series[]][] = [
    [
      'Blood pressure',
      'mmHg',
      [
        { label: 'Systolic', color: rgb(0.75, 0.1, 0.15), values: asc.map((v) => v.bpSystolic), marker: 'circle' },
        { label: 'Diastolic', color: rgb(0.1, 0.3, 0.7), values: asc.map((v) => v.bpDiastolic), dashed: true, marker: 'square' },
      ],
    ],
    ['Weight', 'kg', [{ label: 'Weight', color: rgb(0.2, 0.5, 0.25), values: asc.map((v) => v.weightKg), marker: 'circle' }]],
    ['Fetal heart rate', 'bpm', [{ label: 'FHR', color: rgb(0.55, 0.12, 0.3), values: asc.map((v) => v.fhr), marker: 'circle' }]],
    ['Glucose', 'mg/dL', [{ label: 'Glucose', color: rgb(0.7, 0.45, 0.05), values: asc.map((v) => v.glucoseMgDl), marker: 'circle' }]],
  ];
  for (let i = 0; i < charts.length; i += 2) {
    L.ensure(chartH + 10);
    for (let j = 0; j < 2 && i + j < charts.length; j++) {
      const [title, unit, series] = charts[i + j];
      drawChart(L, MARGIN_X + j * (chartW + 15), L.y, chartW, chartH, title, unit, labels, series);
    }
    L.y -= chartH + 10;
  }
}

// ── summary block ───────────────────────────────────────────────────────────
function drawSummary(L: Layout, view: HospitalReferralView): void {
  L.heading('Q summary');
  const content: QSummaryContent | null = view.summary.content;
  if (!content) {
    L.text('AI summary unavailable — raw chart below', { bold: true, color: ACCENT });
    if (view.summary.state === 'pending' || view.summary.state === 'generating') L.text('The AI summary had not been generated when this PDF was created.', { color: MUTED, size: 8.5 });
    return;
  }
  const tags = view.referral.type === 'checkup' ? ['AI-generated', 'Midwife-reviewed'] : ['AI-generated', 'AI summary generated after referral transmission'];
  L.text(tags.join('  |  '), { bold: true, color: ACCENT, size: 9 });
  L.text('AI-generated summary of documented records. Not a diagnosis or treatment recommendation.', { color: MUTED, size: 8 });
  L.space(3);
  L.text(content.summary);
  L.space(3);
  L.text('Reason for referral', { bold: true });
  L.text(content.reasonForReferral, { indent: 8 });
  L.text('Key findings', { bold: true });
  L.bullets(content.keyFindings);
  L.text('Risk flags (recorded values for clinical review)', { bold: true });
  L.bullets(content.riskFlags, 'None recorded');
  L.text('Documented trends', { bold: true });
  L.bullets(content.abnormalTrends, 'None recorded');
  L.text('Medications', { bold: true });
  L.bullets(content.medications);
}

// ── page decorations ────────────────────────────────────────────────────────
function decoratePages(doc: PDFDocument, fonts: Fonts, idLabel: string, generatedAtMillis: number, linkExpiresAtMillis: number | null): void {
  const pages = doc.getPages();
  const total = pages.length;
  const id = sanitizePdfText(idLabel);
  pages.forEach((page, i) => {
    page.drawText('CONFIDENTIAL: PATIENT RECORD', { x: 95, y: 250, size: 38, font: fonts.bold, color: rgb(0.6, 0.6, 0.65), opacity: 0.12, rotate: degrees(35) });
    page.drawText(id, { x: 150, y: 215, size: 22, font: fonts.bold, color: rgb(0.6, 0.6, 0.65), opacity: 0.12, rotate: degrees(35) });

    page.drawLine({ start: { x: MARGIN_X, y: 46 }, end: { x: PAGE_W - MARGIN_X, y: 46 }, thickness: 0.5, color: RULE });
    const size = 7;
    page.drawText(sanitizePdfText(`Confidential: Patient Record  |  ${id}`), { x: MARGIN_X, y: 34, size, font: fonts.bold, color: MUTED });
    const pageLabel = `Page ${i + 1}/${total}`;
    page.drawText(pageLabel, { x: PAGE_W - MARGIN_X - fonts.regular.widthOfTextAtSize(pageLabel, size), y: 34, size, font: fonts.regular, color: MUTED });
    const expiry = linkExpiresAtMillis ? manilaDateTime(linkExpiresAtMillis) : 'Not applicable';
    page.drawText(sanitizePdfText(`Generated ${manilaDateTime(generatedAtMillis)}  |  Link expires ${expiry}`), { x: MARGIN_X, y: 24, size, font: fonts.regular, color: MUTED });
  });
}

function patientRows(p: HospitalReferralView['patient']): [string, string][] {
  return [
    ['Name', p.name],
    ['Patient ID', p.patientId],
    ['Age', p.ageYears == null ? NOT_DOCUMENTED : `${p.ageYears} years`],
    ['Gestational age', p.gestationalAge],
    ['Trimester', p.trimester],
    ['EDD', p.pregnancy.edd],
    ['LMP', p.pregnancy.lmp],
    [
      'Gravida / Para',
      // Plain words so it reads at a glance: gravida = all pregnancies (twins = 1); para = births at 20+ weeks.
      `G${p.pregnancy.gravida} P${p.pregnancy.para} (${p.pregnancy.gravida} ${p.pregnancy.gravida === 1 ? 'pregnancy' : 'pregnancies'} incl. current, ${p.pregnancy.para} ${p.pregnancy.para === 1 ? 'birth' : 'births'} at 20+ weeks)`,
    ],
    ['Blood type', p.bloodType],
    ['Allergies', p.allergies.length ? p.allergies.join(', ') : 'None documented'],
    ['Medical history', p.medicalHistory.join(', ')],
    ['Obstetric history', p.obstetricHistory.join(', ')],
  ];
}

/** Builds the referral (or patient-only) PDF. Pure apart from pdf-lib; no I/O. */
export async function buildReferralPdf(input: BuildPdfInput): Promise<Uint8Array> {
  const view = input.view;
  const data = view ?? input.patientOnly;
  if (!data) throw new Error('buildReferralPdf requires a view or patientOnly data');

  const doc = await PDFDocument.create();
  const fonts: Fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const idLabel = view ? view.referral.referralId : 'Patient record export';
  doc.setTitle(view ? `MARA referral ${view.referral.referralId}` : 'MARA patient record export');
  doc.setCreator('MARA');
  doc.setProducer('MARA');

  const L = new Layout(doc, fonts);
  L.text('MARA - Maternal Referral and Admission', { size: 9, color: MUTED });
  L.text(view ? `${view.referral.type === 'emergency' ? 'EMERGENCY REFERRAL' : 'CHECKUP REFERRAL'}  ${view.referral.referralId}` : 'Patient record export', { size: 16, bold: true, color: view?.referral.type === 'emergency' ? rgb(0.75, 0.1, 0.15) : INK });
  L.space(4);

  if (view) {
    L.keyValues([
      ['Referral ID', view.referral.referralId],
      ['Type', view.referral.type === 'emergency' ? 'Emergency' : 'Checkup'],
      ['Status', view.referral.status],
      ['Created', manilaDateTime(view.referral.createdAtMillis)],
      ['Sent', view.referral.sentAtMillis ? manilaDateTime(view.referral.sentAtMillis) : 'Not sent'],
      ['Reason', [view.referral.reason.label, view.referral.reason.text].filter(Boolean).join(': ')],
      ['Referring clinic', [view.clinic.name, view.clinic.address, view.clinic.contactNumber].filter(Boolean).join(' | ')],
      ['Midwife', [view.midwife.name, view.midwife.contactNumber].filter(Boolean).join(' | ')],
      ['Receiving hospital', view.hospital.name],
    ]);
  } else if (input.patientOnly) {
    L.keyValues([
      ['Clinic', [input.patientOnly.clinic.name, input.patientOnly.clinic.address, input.patientOnly.clinic.contactNumber].filter(Boolean).join(' | ')],
      ['Exported', manilaDateTime(input.generatedAtMillis)],
    ]);
  }

  L.heading('Patient');
  L.keyValues(patientRows(data.patient));

  if (view) drawSummary(L, view);

  L.heading('Recorded values for clinical review');
  L.bullets(
    data.riskFlags.map((f) => `${f.visitDate}: ${f.label}. ${f.detail}`),
    'No recorded values exceed configured review thresholds.',
  );

  L.heading('Current medications');
  L.bullets(data.currentMedications, 'None documented');
  L.heading('Allergies');
  L.bullets(data.patient.allergies, 'None documented');

  L.heading('Trends');
  drawCharts(L, data.visits);

  L.heading('Visit timeline (newest first)');
  drawVisitTable(L, data.visits);

  decoratePages(doc, fonts, idLabel, input.generatedAtMillis, view ? view.referral.linkExpiresAtMillis : null);
  return doc.save();
}

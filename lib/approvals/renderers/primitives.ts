/**
 * Small typed helpers over the `docx` library used by every doc-type
 * renderer. Kept intentionally minimal — the assembly is fully structured,
 * so we never have to parse HTML or embed dynamic images at this stage.
 *
 * All colours are hex, all widths are in DXA (1/20 pt). The house style
 * closely tracks what /grant-notes exports today: sans-serif body,
 * simple borders, subtle header shading.
 */

import {
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  ShadingType,
  HeadingLevel,
} from 'docx';

/* ────────── tokens ────────── */

export const FONT = 'Calibri';
export const COLOR_MUTED = '6B7280';   // stone-500
export const COLOR_BODY = '111827';    // stone-900
export const COLOR_HEAD = 'F3F4F6';    // stone-100
export const COLOR_ACCENT = '0F766E';  // teal-700

const BORDER_LIGHT = { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' };
export const ALL_BORDERS = {
  top: BORDER_LIGHT,
  bottom: BORDER_LIGHT,
  left: BORDER_LIGHT,
  right: BORDER_LIGHT,
};

/* ────────── formatters ────────── */

export const money = (n: number | undefined | null): string => {
  if (n == null || !Number.isFinite(n) || n === 0) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
};

export const numFmt = (n: number | undefined | null): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-IN').format(Math.round(n));
};

export const pct = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${Math.round(n)}%`;
};

/* ────────── typographic paragraphs ────────── */

export function docTitle(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.TITLE,
    spacing: { after: 240 },
    children: [
      new TextRun({ text, font: FONT, size: 32, bold: true, color: COLOR_BODY }),
    ],
  });
}

export function h1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    children: [
      new TextRun({ text, font: FONT, size: 26, bold: true, color: COLOR_BODY }),
    ],
  });
}

export function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [
      new TextRun({ text, font: FONT, size: 22, bold: true, color: COLOR_BODY }),
    ],
  });
}

export function h3(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [
      new TextRun({ text, font: FONT, size: 20, bold: true, color: COLOR_ACCENT }),
    ],
  });
}

export function body(text: string, opts: { bold?: boolean; italic?: boolean; muted?: boolean } = {}): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({
        text: text || '—',
        font: FONT,
        size: 20,
        bold: opts.bold,
        italics: opts.italic,
        color: opts.muted ? COLOR_MUTED : COLOR_BODY,
      }),
    ],
  });
}

export function bullet(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, font: FONT, size: 20, color: COLOR_BODY })],
  });
}

export function empty(): Paragraph {
  return new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text: ' ', font: FONT, size: 18 })],
  });
}

/* ────────── table building blocks ────────── */

export type CellStyle = {
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  shading?: string;
  muted?: boolean;
  width?: number; // percent 1..100
};

export function cell(text: string, style: CellStyle = {}): TableCell {
  return new TableCell({
    width: style.width ? { size: style.width, type: WidthType.PERCENTAGE } : undefined,
    shading: style.shading
      ? { type: ShadingType.CLEAR, color: 'auto', fill: style.shading }
      : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        alignment:
          style.align === 'right'
            ? AlignmentType.RIGHT
            : style.align === 'center'
              ? AlignmentType.CENTER
              : AlignmentType.LEFT,
        children: [
          new TextRun({
            text: text || '—',
            font: FONT,
            size: 18,
            bold: style.bold,
            color: style.muted ? COLOR_MUTED : COLOR_BODY,
          }),
        ],
      }),
    ],
  });
}

export function headerRow(labels: string[], widths?: number[]): TableRow {
  return new TableRow({
    tableHeader: true,
    children: labels.map((l, i) =>
      cell(l, { bold: true, shading: COLOR_HEAD, width: widths?.[i] }),
    ),
  });
}

export function dataRow(values: string[], styles?: CellStyle[]): TableRow {
  return new TableRow({
    children: values.map((v, i) => cell(v, styles?.[i] ?? {})),
  });
}

/** Two-column key/value block used in header + finance summary cards. */
export function kvTable(rows: Array<{ label: string; value: string }>): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: ALL_BORDERS,
    rows: rows.map(
      (r) =>
        new TableRow({
          children: [
            cell(r.label, { bold: true, width: 30, shading: 'F9FAFB' }),
            cell(r.value, { width: 70 }),
          ],
        }),
    ),
  });
}

/** Two-column "row label | free-form paragraph" used for the main-body table. */
export function labelValueTable(
  rows: Array<{ label: string; paragraphs: Paragraph[] }>,
): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: ALL_BORDERS,
    rows: rows.map(
      (r) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 22, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F9FAFB' },
              margins: { top: 100, bottom: 100, left: 120, right: 120 },
              children: [
                new Paragraph({
                  children: [new TextRun({ text: r.label, font: FONT, size: 20, bold: true })],
                }),
              ],
            }),
            new TableCell({
              width: { size: 78, type: WidthType.PERCENTAGE },
              margins: { top: 100, bottom: 100, left: 120, right: 120 },
              children: r.paragraphs.length > 0 ? r.paragraphs : [body('—', { muted: true })],
            }),
          ],
        }),
    ),
  });
}

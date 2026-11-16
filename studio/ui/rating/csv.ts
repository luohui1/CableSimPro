// A table the engineer takes away: its rows as comma-separated text a spreadsheet opens. Made in the browser from the run record
// that is shown, so the file holds exactly the numbers on the screen, in the units of their columns.

const cell = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const csvOf = (rows: (string | number | null | undefined)[][]): string => rows.map(row => row.map(cell).join(',')).join('\r\n');

/** Saves text as a file: with the byte-order mark a spreadsheet needs to read Chinese in UTF-8. */
export function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name.replace(/[\\/:*?"<>|]/g, '-');
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

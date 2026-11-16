// A table the engineer takes away: its rows as comma-separated text a spreadsheet opens. Made in the browser from the run record
// that is shown, so the file holds exactly the numbers on the screen, in the units of their columns.

/** The mark a spreadsheet needs at the start of a UTF-8 file to read Chinese (written as its code, so the file shows it). */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/** A text that starts like a formula (a project's name, a method's message) is not read as one by a spreadsheet. */
const FORMULA = /^[=+\-@\t\r]/;

const cell = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return '';
  // Numbers are as they are: a negative one is not a formula.
  const text = typeof value === 'string' && FORMULA.test(value) ? `'${value}` : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const csvOf = (rows: (string | number | null | undefined)[][]): string => rows.map(row => row.map(cell).join(',')).join('\r\n');

/** Saves text as a file: with the byte-order mark a spreadsheet needs to read Chinese in UTF-8. */
export function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([BYTE_ORDER_MARK, text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name.replace(/[\\/:*?"<>|]/g, '-');
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers take the file after the click has returned.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

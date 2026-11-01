/** Minimal RFC 4180 CSV writer and parser (no dependencies). */

type Cell = string | number | boolean | null | undefined;

/**
 * Neutralizes spreadsheet formula injection: cells starting with = + - @ or a
 * tab/CR are prefixed with an apostrophe so Excel/Sheets treat them as text.
 * Plain numbers (e.g. "-3") are left alone.
 */
function protectFormula(value: string): string {
  if (/^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value)) return `'${value}`;
  return value;
}

function escapeCell(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  const text = protectFormula(String(cell));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: readonly (readonly Cell[])[]): string {
  // CRLF per RFC 4180; BOM so Excel detects UTF-8 (names may be non-ASCII).
  return "\uFEFF" + rows.map((row) => row.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * Parses CSV text into rows of cells. Throws on an unterminated quote.
 * Blank rows are dropped unless `keepBlank` is set (to preserve row numbering).
 */
export function parseCsv(text: string, opts: { keepBlank?: boolean } = {}): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
      i++;
    } else if (ch === "\r" || ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += ch === "\r" && input[i + 1] === "\n" ? 2 : 1;
    } else {
      cell += ch;
      i++;
    }
  }
  if (inQuotes) throw new Error("Unterminated quoted field in CSV.");
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return opts.keepBlank ? rows : rows.filter((r) => !isBlankRow(r));
}

export function isBlankRow(row: readonly string[]): boolean {
  return row.every((c) => c.trim() === "");
}

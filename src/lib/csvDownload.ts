/** RFC-4180-style cell escaping for generated CSV downloads. */
export function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function rowToCsvLine(cells: string[]): string {
  return cells.map(escapeCsvCell).join(",");
}

/** UTF-8 BOM helps Excel recognize encoding when opening CSV files. */
export function downloadCsv(filename: string, lines: string[]) {
  const body = lines.join("\r\n");
  const blob = new Blob(["\uFEFF", body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

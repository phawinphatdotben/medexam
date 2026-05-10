import { splitCsvLine } from "@/lib/parseMeqStagesCsv";

const LETTERS = "ABCDEFGHIJKLMNOP".split("") as readonly string[];

export type ParsedSbaQuestionRow = {
  stem: string;
  image_url: string;
  options: { id: string; text: string }[];
  correct_option_id: string;
};

const HEADER_ALIASES: Record<string, "stem" | "image_url" | "correct_option_id" | "skip"> = {
  stem: "stem",
  question: "stem",
  question_text: "stem",
  image_url: "image_url",
  picture: "image_url",
  url: "image_url",
  media: "image_url",
  correct_option_id: "correct_option_id",
  correct: "correct_option_id",
  answer: "correct_option_id",
};

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Maps a header cell to option letter A–P, or null if not an option column. */
function optionLetterFromHeader(cell: string): string | null {
  const n = normHeader(cell);
  if (/^[a-p]$/.test(n)) return n.toUpperCase();
  const m = /^option_([a-p])$/.exec(n);
  if (m) return m[1]!.toUpperCase();
  return null;
}

/** Parse CSV into SBA question drafts. Expects a header row with stem and option columns (A, B, …). */
export function parseSbaQuestionsCsv(
  text: string,
): { ok: true; rows: ParsedSbaQuestionRow[] } | { ok: false; error: string } {
  const rawLines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const lines = rawLines.map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { ok: false, error: "CSV is empty." };
  }

  const headerCells = splitCsvLine(lines[0]!);
  const colStem: Partial<Record<"stem" | "image_url" | "correct_option_id", number>> = {};
  const optionCols: Record<string, number> = {};
  const usedOptionLetters = new Set<string>();

  for (let i = 0; i < headerCells.length; i++) {
    const raw = headerCells[i]!;
    const nk = normHeader(raw);
    const alias = HEADER_ALIASES[nk];
    const optLet = optionLetterFromHeader(raw);
    if (alias && alias !== "skip") {
      colStem[alias] = i;
    } else if (optLet) {
      if (usedOptionLetters.has(optLet)) {
        return { ok: false, error: `Duplicate option column "${raw.trim()}" in header.` };
      }
      usedOptionLetters.add(optLet);
      optionCols[optLet] = i;
    }
  }

  if (colStem.stem === undefined) {
    return {
      ok: false,
      error:
        'CSV header row must include a stem column (header name: stem, question, or question_text) and choice columns named A, B, C, … — use "Download CSV template".',
    };
  }

  if (colStem.correct_option_id === undefined) {
    return {
      ok: false,
      error:
        'CSV header row must include correct_option_id (aliases: correct, answer). See "Download CSV template".',
    };
  }

  const optionLettersPresent = Object.keys(optionCols).sort(
    (a, b) => a.charCodeAt(0)! - b.charCodeAt(0)!,
  );
  if (optionLettersPresent.length < 2) {
    return {
      ok: false,
      error: "Include at least two option columns (e.g. A and B) in the header row.",
    };
  }

  const rows: ParsedSbaQuestionRow[] = [];

  for (let li = 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li]!);
    const stem = (cells[colStem.stem!] ?? "").trim();
    if (!stem) {
      return { ok: false, error: `Row ${li + 1}: stem is required.` };
    }

    const image_url =
      colStem.image_url !== undefined ? (cells[colStem.image_url] ?? "").trim() : "";

    const correctRaw = (cells[colStem.correct_option_id!] ?? "").trim().toUpperCase();
    if (!correctRaw || !/^[A-P]$/.test(correctRaw)) {
      return {
        ok: false,
        error: `Row ${li + 1}: correct_option_id must be a single letter A–P (got "${correctRaw || "(empty)"}").`,
      };
    }

    const options: { id: string; text: string }[] = [];
    for (const letter of LETTERS) {
      const idx = optionCols[letter];
      if (idx === undefined) continue;
      const t = (cells[idx] ?? "").trim();
      if (t) options.push({ id: letter, text: t });
    }

    if (options.length < 2) {
      return {
        ok: false,
        error: `Row ${li + 1}: fill at least two answer choices (non-empty A/B/… cells).`,
      };
    }

    const ids = new Set(options.map((o) => o.id));
    if (!ids.has(correctRaw)) {
      return {
        ok: false,
        error: `Row ${li + 1}: correct_option_id "${correctRaw}" must match a letter column that has choice text.`,
      };
    }

    rows.push({
      stem,
      image_url,
      options,
      correct_option_id: correctRaw,
    });
  }

  if (rows.length === 0) {
    return { ok: false, error: "No question rows found after the header row." };
  }

  return { ok: true, rows };
}

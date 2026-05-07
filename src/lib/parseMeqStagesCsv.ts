/**
 * Minimal RFC-4180-style CSV parse: comma-separated, double-quote escapes.
 */

export type ParsedStageRow = {
  sequence_order: number;
  time_limit_minutes: string;
  stage_information: string;
  question_text: string;
  rubric_criteria: string;
  max_score: string;
  media_url: string;
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const HEADER_ALIASES: Record<string, keyof ParsedStageRow | "skip"> = {
  stage: "sequence_order",
  sequence: "sequence_order",
  sequence_order: "sequence_order",
  order: "sequence_order",
  time_limit_minutes: "time_limit_minutes",
  time: "time_limit_minutes",
  minutes: "time_limit_minutes",
  stage_information: "stage_information",
  info: "stage_information",
  question_text: "question_text",
  question: "question_text",
  stem: "question_text",
  rubric_criteria: "rubric_criteria",
  rubric: "rubric_criteria",
  max_score: "max_score",
  max: "max_score",
  media_url: "media_url",
  media: "media_url",
  url: "media_url",
};

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Parse CSV text into stage drafts for MEQ wizard. Returns error message or rows. */
export function parseMeqStagesCsv(text: string): { ok: true; rows: ParsedStageRow[] } | { ok: false; error: string } {
  const rawLines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const lines = rawLines.map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { ok: false, error: "CSV is empty." };
  }

  const firstCells = splitCsvLine(lines[0]!);
  const firstLower = firstCells.map(normHeader);
  const looksHeader =
    firstLower.some((c) => HEADER_ALIASES[c] !== undefined) &&
    !firstLower.every((c) => /^\d+$/.test(c));

  let start = 0;
  const colMap: Partial<Record<keyof ParsedStageRow, number>> = {};

  if (looksHeader) {
    start = 1;
    for (let i = 0; i < firstCells.length; i++) {
      const key = HEADER_ALIASES[normHeader(firstCells[i]!)];
      if (key && key !== "skip") {
        colMap[key] = i;
      }
    }
    if (colMap.question_text === undefined || colMap.rubric_criteria === undefined) {
      return {
        ok: false,
        error:
          "CSV header row must include at least question (question_text) and rubric (rubric_criteria) columns.",
      };
    }
  } else {
    // Positional: stage, time_limit_minutes, stage_information, question_text, rubric_criteria, max_score, media_url
    if (firstCells.length < 5) {
      return {
        ok: false,
        error:
          "Each data row needs at least: stage, time_limit_minutes, stage_information, question_text, rubric_criteria, max_score (optional: media_url). Or use a header row.",
      };
    }
    colMap.sequence_order = 0;
    colMap.time_limit_minutes = 1;
    colMap.stage_information = 2;
    colMap.question_text = 3;
    colMap.rubric_criteria = 4;
    colMap.max_score = 5;
    colMap.media_url = 6;
  }

  const rows: ParsedStageRow[] = [];

  for (let li = start; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li]!);
    const get = (k: keyof ParsedStageRow): string => {
      const idx = colMap[k];
      if (idx === undefined) {
        if (k === "stage_information" || k === "media_url") return "";
        if (k === "time_limit_minutes") return "15";
        if (k === "sequence_order") return String(rows.length + 1);
        return "";
      }
      return (cells[idx] ?? "").trim();
    };

    const seqRaw = get("sequence_order");
    const so = parseInt(seqRaw, 10);
    const sequence_order = Number.isFinite(so) && so > 0 ? so : rows.length + 1;

    const q = get("question_text");
    const rub = get("rubric_criteria");
    if (!q || !rub) {
      return { ok: false, error: `Row ${li + 1}: question_text and rubric_criteria are required.` };
    }

    const tl = get("time_limit_minutes");
    const tlNum = parseInt(tl, 10);
    if (!tl || isNaN(tlNum) || tlNum < 1) {
      return { ok: false, error: `Row ${li + 1}: time_limit_minutes must be a positive number.` };
    }

    const ms = get("max_score");
    const msNum = parseInt(ms, 10);
    if (!ms || isNaN(msNum) || msNum < 1 || msNum > 100) {
      return { ok: false, error: `Row ${li + 1}: max_score must be between 1 and 100.` };
    }

    rows.push({
      sequence_order,
      time_limit_minutes: String(tlNum),
      stage_information: get("stage_information"),
      question_text: q,
      rubric_criteria: rub,
      max_score: String(msNum),
      media_url: get("media_url"),
    });
  }

  if (rows.length === 0) {
    return { ok: false, error: "No stage rows found in CSV." };
  }

  rows.sort((a, b) => a.sequence_order - b.sequence_order);
  return { ok: true, rows };
}

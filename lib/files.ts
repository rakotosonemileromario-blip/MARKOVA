import Papa from "papaparse";
import { computeKpiSummary, type Row } from "./kpi";

export type FileKind = "pdf" | "docx" | "tableur" | "texte" | "image" | "autre";

export const MAX_TEXT_CHARS = 120_000;

export function detectKind(name: string, mime: string): FileKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (["xlsx", "xlsm", "csv", "tsv"].includes(ext)) return "tableur";
  if (["txt", "md", "json", "html", "htm"].includes(ext) || mime.startsWith("text/")) return "texte";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(ext)) return "image";
  return "autre";
}

export type Extraction = { text: string | null; kpi: string | null; note?: string };

/** Extrait le contenu lisible d'un fichier (texte, tableaux, KPI). */
export async function extractContent(name: string, kind: FileKind, bytes: Uint8Array): Promise<Extraction> {
  const ext = name.toLowerCase().split(".").pop() ?? "";

  switch (kind) {
    case "pdf": {
      const { extractText } = await import("unpdf");
      const { text, totalPages } = await extractText(new Uint8Array(bytes), { mergePages: true });
      const clean = text.trim();
      return {
        text: clean ? truncate(`[PDF — ${totalPages} pages]\n${clean}`) : null,
        kpi: null,
        note: clean ? undefined : "PDF sans texte (scan) : il sera envoyé tel quel au modèle.",
      };
    }
    case "docx": {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return { text: truncate(value.trim()), kpi: null };
    }
    case "tableur": {
      const sheets = ext === "xlsx" || ext === "xlsm" ? await readXlsx(bytes) : [readCsv(bytes, ext === "tsv")];
      const texts: string[] = [];
      const kpis: string[] = [];
      for (const s of sheets) {
        texts.push(`[Feuille ${s.name}] ${s.rows.length} lignes\n${toCsv(s.rows)}`);
        const k = computeKpiSummary(s.rows, sheets.length > 1 ? s.name : undefined);
        if (k) kpis.push(k);
      }
      return { text: truncate(texts.join("\n\n")), kpi: kpis.length ? kpis.join("\n\n") : null };
    }
    case "texte":
      return { text: truncate(new TextDecoder().decode(bytes)), kpi: null };
    case "image":
      return { text: null, kpi: null, note: "Image : analysée visuellement par le modèle." };
    default:
      return { text: null, kpi: null, note: "Format non pris en charge en V1." };
  }
}

type Sheet = { name: string; rows: Row[] };

function readCsv(bytes: Uint8Array, tsv: boolean): Sheet {
  let text = new TextDecoder("utf-8").decode(bytes);
  // Les exports Meta sont parfois en UTF-16 : on retente si le décodage paraît corrompu.
  if (text.includes("\u0000")) text = new TextDecoder("utf-16le").decode(bytes);
  const parsed = Papa.parse<Row>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
    delimiter: tsv ? "\t" : "",
  });
  return { name: "CSV", rows: parsed.data };
}

async function readXlsx(bytes: Uint8Array): Promise<Sheet[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const sheets: Sheet[] = [];
  wb.eachSheet((ws) => {
    const headers: string[] = [];
    const rows: Row[] = [];
    ws.eachRow({ includeEmpty: false }, (row, i) => {
      const values = (row.values as unknown[]).slice(1).map(cellValue);
      if (i === 1 || headers.length === 0) {
        values.forEach((v, j) => (headers[j] = String(v ?? `Colonne ${j + 1}`).trim()));
        return;
      }
      const r: Row = {};
      headers.forEach((h, j) => (r[h] = values[j] ?? ""));
      rows.push(r);
    });
    sheets.push({ name: ws.name, rows });
  });
  return sheets;
}

function cellValue(v: unknown): unknown {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return cellValue(o.result);
    if ("text" in o) return o.text;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("error" in o) return String(o.error);
  }
  return v;
}

function toCsv(rows: Row[]) {
  return Papa.unparse(rows.slice(0, 2000));
}

function truncate(s: string) {
  return s.length > MAX_TEXT_CHARS ? `${s.slice(0, MAX_TEXT_CHARS)}\n…[tronqué : ${s.length - MAX_TEXT_CHARS} caractères supplémentaires]` : s;
}

import { normalizeDomain } from "../normalize/domain.js";
import { normalizePhone } from "../normalize/phone.js";

/**
 * Reads a CSV of businesses into rows the discovery pipeline can already handle.
 *
 * Pure: no I/O, no database, no network. It parses, validates, and reports — deciding what
 * happens to a valid row is the caller's job, and the caller uses the *same*
 * `resolveBusinessForRawResult` that Maps results go through, so imported businesses deduplicate
 * against each other and against everything already discovered without a second identity system
 * being written.
 *
 * Every rejection carries a row number and a reason. A file where 8 of 120 rows failed silently
 * is a file the operator will assume imported cleanly, and they will go looking for businesses
 * that were never created.
 */

export interface ImportRow {
  /** 1-based, counting the header as row 1 — what a spreadsheet shows in its own gutter. */
  rowNumber: number;
  name: string;
  domain: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
}

export interface ImportRejection {
  rowNumber: number;
  reason: string;
  /** The offending value, so the operator can find it in their spreadsheet. */
  value: string | null;
}

export interface ParsedImport {
  rows: ImportRow[];
  rejected: ImportRejection[];
  /** Which of our fields each CSV column was matched to — shown so a wrong guess is visible. */
  columnMapping: Record<string, string>;
  /** Header names we could not place. Not an error; shown so nothing looks silently dropped. */
  unmatchedColumns: string[];
  totalDataRows: number;
}

/**
 * Header names people actually use. Matching is deliberately generous — a spreadsheet exported
 * from a CRM says "Company Name", one typed by hand says "business", and refusing either would
 * make the operator re-type a file to satisfy a computer.
 */
const HEADER_ALIASES: Record<keyof Omit<ImportRow, "rowNumber">, string[]> = {
  name: ["name", "business", "business name", "company", "company name", "businessname", "title", "shop", "shop name"],
  domain: ["website", "url", "domain", "web", "site", "website url", "web address", "homepage"],
  phone: ["phone", "telephone", "tel", "phone number", "mobile", "contact number", "number"],
  email: ["email", "e-mail", "email address", "contact email", "mail"],
  city: ["city", "town", "locality"],
  state: ["state", "province", "region", "county"],
  address: ["address", "street", "street address", "full address", "location", "address line 1"],
};

const MAX_ROWS = 5000;

export function parseBusinessCsv(text: string): ParsedImport {
  const grid = parseCsvGrid(text);
  const empty: ParsedImport = {
    rows: [],
    rejected: [],
    columnMapping: {},
    unmatchedColumns: [],
    totalDataRows: 0,
  };

  if (grid.length === 0) return empty;

  const header = grid[0] ?? [];
  const { mapping, unmatched } = matchHeaders(header);

  if (mapping.name === undefined) {
    return {
      ...empty,
      unmatchedColumns: header,
      rejected: [
        {
          rowNumber: 1,
          reason:
            "No column looks like a business name. Rename one of your columns to 'name', 'business' or 'company'.",
          value: header.join(", ").slice(0, 200),
        },
      ],
    };
  }

  const rows: ImportRow[] = [];
  const rejected: ImportRejection[] = [];
  const dataRows = grid.slice(1);

  for (const [index, cells] of dataRows.entries()) {
    const rowNumber = index + 2; // +1 for the header, +1 because spreadsheets count from 1
    if (rows.length >= MAX_ROWS) {
      rejected.push({
        rowNumber,
        reason: `More than ${MAX_ROWS} rows — split the file and import it in parts.`,
        value: null,
      });
      break;
    }

    const at = (field: keyof typeof mapping): string | null => {
      const column = mapping[field];
      if (column === undefined) return null;
      const value = (cells[column] ?? "").trim();
      return value.length > 0 ? value : null;
    };

    // A row that is entirely blank is what a spreadsheet leaves behind at the end of a file. It
    // is not an error worth reporting — it is not a row.
    if (cells.every((cell) => cell.trim().length === 0)) continue;

    const name = at("name");
    if (!name) {
      rejected.push({ rowNumber, reason: "No business name.", value: null });
      continue;
    }

    // Validated at the door, exactly as the manual-entry form does. Anything that fails is
    // rejected with its reason rather than stored as a value nothing can look up again.
    const rawDomain = at("domain");
    const domain = rawDomain ? normalizeDomain(rawDomain) : null;
    if (rawDomain && domain === null) {
      rejected.push({
        rowNumber,
        reason: `"${rawDomain}" does not look like a website address.`,
        value: rawDomain,
      });
      continue;
    }

    const rawPhone = at("phone");
    const phone = rawPhone ? normalizePhone(rawPhone)?.e164 ?? null : null;
    if (rawPhone && phone === null) {
      rejected.push({
        rowNumber,
        reason: `"${rawPhone}" is not a valid US phone number.`,
        value: rawPhone,
      });
      continue;
    }

    const email = at("email");
    if (email && !/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(email)) {
      rejected.push({ rowNumber, reason: `"${email}" is not a valid email address.`, value: email });
      continue;
    }

    rows.push({
      rowNumber,
      name,
      domain,
      phone,
      email,
      city: at("city"),
      state: at("state"),
      address: at("address"),
    });
  }

  return {
    rows,
    rejected,
    columnMapping: Object.fromEntries(
      Object.entries(mapping).map(([field, column]) => [field, header[column as number] ?? ""]),
    ),
    unmatchedColumns: unmatched,
    totalDataRows: dataRows.filter((cells) => cells.some((c) => c.trim().length > 0)).length,
  };
}

function matchHeaders(header: string[]): {
  mapping: Partial<Record<keyof Omit<ImportRow, "rowNumber">, number>>;
  unmatched: string[];
} {
  const mapping: Partial<Record<keyof Omit<ImportRow, "rowNumber">, number>> = {};
  const used = new Set<number>();

  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [
    keyof Omit<ImportRow, "rowNumber">,
    string[],
  ][]) {
    const index = header.findIndex((cell, i) => {
      if (used.has(i)) return false;
      const normalised = cell.trim().toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");
      return aliases.includes(normalised);
    });
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }

  const unmatched = header.filter((_, i) => !used.has(i)).filter((h) => h.trim().length > 0);
  return { mapping, unmatched };
}

/**
 * A CSV reader that handles quoted fields, embedded commas, embedded newlines and doubled quotes.
 *
 * Written rather than pulled in as a dependency because the whole grammar is fifty lines and the
 * failure mode of getting it wrong — silently splitting `"Smith, Jones & Co"` into two columns and
 * shifting every field after it — is exactly the kind of quiet corruption this project spends its
 * effort avoiding. A dependency would also have to be reviewed to trust it this far.
 */
export function parseCsvGrid(text: string): string[][] {
  // A UTF-8 BOM is what Excel writes, and it would otherwise become part of the first header.
  const input = text.replace(/^﻿/, "");
  const grid: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'; // an escaped quote inside a quoted field
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      grid.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // Swallowed; the \n that follows ends the row. A lone \r (old Mac files) ends it here.
      if (input[i + 1] !== "\n") {
        row.push(field);
        grid.push(row);
        row = [];
        field = "";
      }
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    grid.push(row);
  }

  return grid.filter((cells) => cells.length > 0);
}

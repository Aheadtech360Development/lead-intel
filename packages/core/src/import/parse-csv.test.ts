import { describe, expect, it } from "vitest";
import { parseBusinessCsv, parseCsvGrid } from "./parse-csv.js";

describe("parseCsvGrid — the grammar", () => {
  it("reads a plain file", () => {
    expect(parseCsvGrid("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  /**
   * The failure this parser exists to prevent: splitting `"Smith, Jones & Co"` into two columns
   * shifts every field after it, so a phone number lands in the city column and nothing looks
   * obviously wrong until someone dials it.
   */
  it("keeps a comma inside quotes as part of the value", () => {
    expect(parseCsvGrid('name,city\n"Smith, Jones & Co",Miami')).toEqual([
      ["name", "city"],
      ["Smith, Jones & Co", "Miami"],
    ]);
  });

  it("handles a doubled quote inside a quoted field", () => {
    expect(parseCsvGrid('name\n"The ""Best"" Salon"')).toEqual([["name"], ['The "Best" Salon']]);
  });

  it("handles a newline inside a quoted field", () => {
    expect(parseCsvGrid('name,address\nAcme,"12 High St\nMiami"')).toEqual([
      ["name", "address"],
      ["Acme", "12 High St\nMiami"],
    ]);
  });

  it("handles Windows line endings", () => {
    expect(parseCsvGrid("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  /** Excel writes a BOM, which would otherwise become part of the first header name. */
  it("strips a UTF-8 byte order mark", () => {
    const grid = parseCsvGrid("﻿name,city\nAcme,Miami");
    expect(grid[0]?.[0]).toBe("name");
  });
});

describe("parseBusinessCsv — matching the columns", () => {
  it.each([
    "name",
    "Business Name",
    "COMPANY",
    "company_name",
    "Shop Name",
  ])("recognises %s as the business name", (header) => {
    const result = parseBusinessCsv(`${header}\nAcme Printing`);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.name).toBe("Acme Printing");
  });

  it.each([["Phone Number"], ["Tel"], ["contact number"]])("recognises %s as the phone", (header) => {
    const result = parseBusinessCsv(`name,${header}\nAcme,(305) 555-0100`);
    expect(result.rows[0]?.phone).toBe("+13055550100");
  });

  it("reports which column it used for what", () => {
    const result = parseBusinessCsv("Company Name,Web Address,Tel\nAcme,acme.com,(305) 555-0100");
    expect(result.columnMapping.name).toBe("Company Name");
    expect(result.columnMapping.domain).toBe("Web Address");
    expect(result.columnMapping.phone).toBe("Tel");
  });

  /** Not an error — but shown, so nothing appears to have been silently thrown away. */
  it("lists columns it could not place", () => {
    const result = parseBusinessCsv("name,Owner Notes,Internal ID\nAcme,likes golf,X-42");
    expect(result.unmatchedColumns).toEqual(["Owner Notes", "Internal ID"]);
    expect(result.rows).toHaveLength(1);
  });

  it("refuses a file with no name column at all, and says how to fix it", () => {
    const result = parseBusinessCsv("website,phone\nacme.com,3055550100");
    expect(result.rows).toEqual([]);
    expect(result.rejected[0]?.reason).toMatch(/business name/i);
  });
});

describe("parseBusinessCsv — validating at the door", () => {
  it("normalises what it keeps", () => {
    const result = parseBusinessCsv("name,website,phone\nAcme Printing,https://WWW.Acme.com/contact,(305) 555-0100");
    expect(result.rows[0]?.domain).toBe("acme.com");
    expect(result.rows[0]?.phone).toBe("+13055550100");
  });

  it.each([
    ["name,website\nAcme,not a website", /website address/i],
    ["name,phone\nAcme,12345", /phone number/i],
    ["name,email\nAcme,not-an-email", /email address/i],
  ])("rejects a bad value rather than storing it", (csv, reason) => {
    const result = parseBusinessCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.rejected[0]?.reason).toMatch(reason);
  });

  /**
   * Every rejection carries the spreadsheet's own row number. A file where 8 of 120 rows failed
   * without saying which is a file the operator assumes imported cleanly.
   */
  it("names the row a spreadsheet would show", () => {
    const result = parseBusinessCsv("name,phone\nGood Co,3055550100\nBad Co,12345\nAlso Good,3055550101");
    expect(result.rows).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.rowNumber).toBe(3); // header is row 1
    expect(result.rejected[0]?.value).toBe("12345");
  });

  it("skips trailing blank rows without calling them errors", () => {
    const result = parseBusinessCsv("name\nAcme\n\n\n");
    expect(result.rows).toHaveLength(1);
    expect(result.rejected).toEqual([]);
  });

  it("keeps a row whose optional fields are empty", () => {
    const result = parseBusinessCsv("name,website,phone,city\nAcme,,,\n");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ name: "Acme", domain: null, phone: null, city: null });
  });

  it("counts the data rows it was given", () => {
    const result = parseBusinessCsv("name\nA\nB\nC");
    expect(result.totalDataRows).toBe(3);
  });
});

describe("parseBusinessCsv — hostile input", () => {
  /**
   * This data arrives from spreadsheets other people made. A name beginning `=` is a formula to
   * Excel, and it is stored verbatim here — the export route is what guards it on the way back
   * out, so the value in the database stays what the file actually said.
   */
  it("stores a formula-looking name as text, unchanged", () => {
    const result = parseBusinessCsv('name\n"=cmd|calc"');
    expect(result.rows[0]?.name).toBe("=cmd|calc");
  });

  it("does not choke on an empty file", () => {
    const result = parseBusinessCsv("");
    expect(result.rows).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("does not choke on a header with no rows under it", () => {
    const result = parseBusinessCsv("name,website\n");
    expect(result.rows).toEqual([]);
    expect(result.totalDataRows).toBe(0);
  });

  it("caps a file that is far too large and says so", () => {
    const huge = ["name", ...Array.from({ length: 5200 }, (_, i) => `Business ${i}`)].join("\n");
    const result = parseBusinessCsv(huge);
    expect(result.rows).toHaveLength(5000);
    expect(result.rejected.at(-1)?.reason).toMatch(/split the file/i);
  });
});

import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "@/lib/csv";
import { parseCandidateCsv } from "@/server/services/candidates";

describe("toCsv", () => {
  it("quotes commas, quotes and newlines, uses CRLF and a UTF-8 BOM", () => {
    const out = toCsv([["a", 'b "c"', "d,e", "f\ng"], [1, null, true]]);
    expect(out).toBe('\uFEFFa,"b ""c""","d,e","f\ng"\r\n1,,true\r\n');
  });

  it("neutralizes spreadsheet formula injection but keeps negative numbers", () => {
    const out = toCsv([['=HYPERLINK("x")', "+1+1", "@SUM(A1)", "-cmd", "-3", "-2.5"]]);
    expect(out).toBe(`\uFEFF"'=HYPERLINK(""x"")",'+1+1,'@SUM(A1),'-cmd,-3,-2.5\r\n`);
  });

  it("round-trips through parseCsv", () => {
    const rows = [["Name", "Description"], ["Verma, Asha", 'Says "hi"'], ["Zoë", "line1\nline2"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("parseCsv", () => {
  it("handles CRLF, LF, quotes, empty cells and blank lines", () => {
    expect(parseCsv('a,b\r\n"x, y",\n\n"q""uote",z')).toEqual([["a", "b"], ["x, y", ""], ['q"uote', "z"]]);
  });

  it("throws on an unterminated quote", () => {
    expect(() => parseCsv('a,"b')).toThrow(/Unterminated/);
  });
});

describe("candidate CSV import", () => {
  it("parses the template format", () => {
    const { rows, errors } = parseCandidateCsv("name,description\nAsha Verma,CSE 3rd year\n\"Rao, Bala\",\n");
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { name: "Asha Verma", description: "CSE 3rd year" },
      { name: "Rao, Bala", description: "" },
    ]);
  });

  it("accepts a name-only file and any column order / header case", () => {
    expect(parseCandidateCsv("Description,NAME\nx,Asha\n").rows).toEqual([{ name: "Asha", description: "x" }]);
    expect(parseCandidateCsv("name\nAsha\n").rows).toEqual([{ name: "Asha", description: "" }]);
  });

  it("reports missing header, empty names, duplicates and long values with line numbers", () => {
    expect(parseCandidateCsv("Asha\nBala\n").errors[0].message).toMatch(/header/);
    const { errors } = parseCandidateCsv(`name,description\nAsha,\n,\nasha,\n${"x".repeat(101)},\n`);
    // Line 3 is blank (skipped, but still counted).
    expect(errors.map((e) => e.line)).toEqual([4, 5]);
    expect(errors[0].message).toMatch(/Duplicate of line 2/);
    expect(parseCandidateCsv("name,description\nAsha,x\n\n,has description\n").errors).toEqual([
      { line: 4, message: "Candidate name is required." },
    ]);
  });

  it("rejects empty files", () => {
    expect(parseCandidateCsv("").errors).toHaveLength(1);
    expect(parseCandidateCsv("name\n").errors[0].message).toMatch(/No candidates/);
  });
});

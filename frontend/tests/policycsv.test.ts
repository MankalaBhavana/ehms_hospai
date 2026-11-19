import { checkImport, parseCsv, parseDate, policyKey, toCsv, POLICY_COLUMNS } from "../src/utils/policyCsv"

let failed = 0
const results: string[] = []
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++
  results.push((ok ? "PASS  " : "FAIL  ") + name + (ok ? "" : " -> " + detail))
}

// dates
check("date yyyy-mm-dd", parseDate("2027-03-09") === "2027-03-09")
check("date dd/mm/yyyy", parseDate("09/03/2027") === "2027-03-09")
check("date dd-mm-yyyy", parseDate("9-3-2027") === "2027-03-09")
check("date blank is empty, not an error", parseDate("  ") === "")
check("impossible date 31/02/2027 rejected", parseDate("31/02/2027") === null)
check("garbage date rejected", parseDate("next year") === null)

// csv reader
const g = parseCsv('﻿UMR,Name\r\n"PAT-1","Rao, K ""Jr"""\r\n\r\nPAT-2,Devi\r\n')
check("quoted commas / quotes / blank lines / BOM", g.length === 3 && g[1][1] === 'Rao, K "Jr"' && g[2][0] === "PAT-2", JSON.stringify(g))
check("semicolon files (Excel in some locales) are read", parseCsv("a;b\n1;2")[1][1] === "2")

// export neutralises spreadsheet formulas, keeps numbers
const out = toCsv(["A", "B"], [['=HYPERLINK("x")', -5]])
check("formula-looking cell is neutralised", out.includes("\"'=HYPERLINK"))
check("negative number is left alone", out.includes('"-5"'))

// import
const ctx = {
  patient: (u: string) => ({ "PAT-1": { umr: "PAT-1", name: "Asha Rao" }, "PAT-2": { umr: "PAT-2", name: "Kiran Devi" } } as Record<string, { umr: string; name: string }>)[u.toUpperCase()],
  insurers: [{ id: "INS-001", name: "Star Health", tpa: "Medi Assist" }],
  existing: new Set([policyKey("PAT-2", "P-200")]),
}
const head = "UMR,Insurance company,Policy number,Member ID,Valid until,Sum insured,Balance available,Co-pay %,Relationship"
const csv = [
  head,
  "PAT-1,star health,P-100,M1,31/12/2027,\"5,00,000\",,10%,Self", // new, balance blank -> equals sum
  "PAT-2,Star Health,p-200,M2,2027-01-15,300000,120000,0,Spouse", // update (case-insensitive policy no)
  "PAT-9,Star Health,P-300,,,,,,", // unknown patient
  "PAT-1,Star Health,,,,,,,", // no policy number
  "PAT-1,Star Health,P-100,,,,,,", // duplicate in file
  "PAT-1,Unlisted Co,P-400,,not a date,abc,,150,Cousin", // several errors
  "PAT-1,Unlisted Co,P-500,,,,,,Cousin", // warnings only
].join("\n")
const res = checkImport(csv, ctx)
const by = (i: number) => res.rows[i]
check("7 data rows read", res.rows.length === 7, String(res.rows.length))
check("row 1 is new, matched to master (id + default TPA)", by(0).status === "new" && by(0).policy?.insurerId === "INS-001" && by(0).policy?.tpaName === "Medi Assist")
check("row 1 amounts: '5,00,000' parsed, blank balance = sum insured, 10% parsed", by(0).policy?.sumInsured === 500000 && by(0).policy?.balanceAvailable === 500000 && by(0).policy?.copayPercentage === 10)
check("row 1 date converted", by(0).policy?.validUntil === "2027-12-31")
check("row 2 is an update of the existing policy", by(1).status === "update" && by(1).policy?.balanceAvailable === 120000 && by(1).policy?.relationship === "Spouse")
check("row 3 unknown UMR is a problem", by(2).status === "error" && /No patient/.test(by(2).errors[0]))
check("row 4 missing policy number is a problem", by(3).status === "error")
check("row 5 duplicate inside the file is a problem", by(4).status === "error" && /earlier in this file/.test(by(4).errors.join()))
check("row 6 reports each bad field", by(5).status === "error" && by(5).errors.length === 3, by(5).errors.join(" | "))
check("row 7 unknown insurer / relationship only warn, still importable", by(6).status === "new" && by(6).warnings.length === 2 && by(6).policy?.relationship === "Other" && by(6).policy?.insurerId === "")
check("patient name always comes from the registry", by(0).policy?.patientName === "Asha Rao")

// file-level problems
check("missing required column explained", /Policy number/.test(checkImport("UMR,Insurance company\nPAT-1,X", ctx).fileError || ""))
check("header only -> no data message", !!checkImport(toCsv(POLICY_COLUMNS, []), ctx).fileError)
// export -> import round trip
const exported = toCsv([...POLICY_COLUMNS, "Validity"], [["PAT-1", "Asha Rao", "Star Health", "Medi Assist", "P-777", "M7", "Asha Rao", "Self", "2028-02-01", 400000, 250000, 5, 4000, 9000, "Valid"]])
const rt = checkImport(exported, ctx)
check("an exported file imports back unchanged", rt.rows[0]?.status === "new" && rt.rows[0].policy?.balanceAvailable === 250000 && rt.rows[0].policy?.validUntil === "2028-02-01" && rt.rows[0].policy?.copayPercentage === 5 && rt.rows[0].policy?.roomRentPerDay === 4000 && rt.rows[0].policy?.icuRentPerDay === 9000)

console.log(results.join("\n"))
console.log(failed ? `${failed} FAILED` : "ALL POLICY CSV CHECKS PASSED")
process.exit(failed ? 1 : 0)

#!/usr/bin/env python3
"""Builds the two Excel deliverables from repository facts.

* docs/SYRONA_REPORT_CATALOGUE.xlsx — every catalogue entry with its status,
  parsed from `src/reporting/report-catalogue.ts` by
  `scripts/documentation/parse-catalogue.py` into docs/documentation/report-catalogue.csv.
* docs/SYRONA_DOCUMENTATION_TRACEABILITY_MATRIX.xlsx — each requirement of
  this documentation issue mapped to where it is answered and what supports it.
"""
from __future__ import annotations

import csv
import pathlib
import re

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

ROOT = pathlib.Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
CATALOGUE = DOCS / "documentation/report-catalogue.csv"

TEAL = "0D5C63"
INK = "172B2E"
GREEN = "E7F3E9"
AMBER = "FBF1DC"
RED = "FBE9E5"

thin = Side(style="thin", color="C9D2D3")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)


def style_sheet(sheet, widths, *, freeze="A2"):
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width
    for cell in sheet[1]:
        cell.font = Font(name="Calibri", bold=True, size=11, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor=TEAL)
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        cell.border = BORDER
    sheet.row_dimensions[1].height = 34
    sheet.freeze_panes = freeze


def body(sheet, *, band=True):
    for index, row in enumerate(sheet.iter_rows(min_row=2), start=2):
        for cell in row:
            cell.font = Font(name="Calibri", size=10)
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.border = BORDER
            if band and index % 2 == 0:
                cell.fill = PatternFill("solid", fgColor="F7F9F9")


def add_table(sheet, name, columns):
    table = Table(displayName=name, ref=f"A1:{get_column_letter(columns)}{sheet.max_row}")
    table.tableStyleInfo = TableStyleInfo(name="TableStyleLight1", showRowStripes=False)
    sheet.add_table(table)


def read_catalogue() -> list[dict]:
    with open(CATALOGUE, newline="") as handle:
        return list(csv.DictReader(handle))


def build_report_catalogue() -> None:
    rows = read_catalogue()
    statuses = {r["status"] for r in rows}
    counts = {s: sum(1 for r in rows if r["status"] == s) for s in statuses}
    engines = sorted({r["engine"] for r in rows if r["engine"]})

    workbook = Workbook()
    cover = workbook.active
    cover.title = "Read me"
    cover.sheet_view.showGridLines = False
    cover.column_dimensions["B"].width = 26
    cover.column_dimensions["C"].width = 96
    cover["B2"] = "Syrona Medical Center HMIS — Report Catalogue"
    cover["B2"].font = Font(name="Calibri", bold=True, size=22, color=INK)
    cover["B3"] = "Companion to SYRONA_COMPLETE_SYSTEM_DOCUMENTATION.docx, Chapter 23"
    cover["B3"].font = Font(name="Calibri", size=12, italic=True, color="4A5C66")
    facts = [
        ("Document ID", "JC-CAT-001"),
        ("Version", "1.0"),
        ("Date", "19 November 2026"),
        ("Base commit", "0111b55"),
        ("Source of truth", "src/reporting/report-catalogue.ts (REPORT_LIBRARY + CATEGORY_ENTRIES)"),
        ("Entries", str(len(rows))),
        ("Available", str(counts.get("available", 0))),
        ("Existing document", str(counts.get("existing-document", 0))),
        ("Not implemented", str(counts.get("unavailable", 0))),
        ("Engines implemented", str(len(engines))),
    ]
    row = 5
    for label, value in facts:
        cover[f"B{row}"] = label
        cover[f"B{row}"].font = Font(name="Calibri", bold=True, size=11, color=TEAL)
        cover[f"C{row}"] = value
        cover[f"C{row}"].font = Font(name="Calibri", size=11)
        cover[f"C{row}"].alignment = Alignment(wrap_text=True, vertical="top")
        row += 1
    cover["B16"] = "How to read the status column"
    cover["B16"].font = Font(name="Calibri", bold=True, size=13, color=INK)
    notes = [
        ("Available", "An engine answers the request with a scoped, documented subset. It is not "
                      "a claim that the full statutory report is complete."),
        ("Existing document", "The entry opens a document workflow that already exists for that "
                              "record instead of a second engine."),
        ("Not implemented", "No engine and no workflow. The 'Required before release' column says "
                            "what is missing. It cannot be produced or exported."),
    ]
    row = 17
    for label, detail in notes:
        cover[f"B{row}"] = label
        cover[f"B{row}"].font = Font(name="Calibri", bold=True, size=10)
        cover[f"C{row}"] = detail
        cover[f"C{row}"].alignment = Alignment(wrap_text=True, vertical="top")
        cover.row_dimensions[row].height = 44
        row += 1
    cover["B21"] = ("This workbook is generated from the code, not maintained by hand. If an "
                    "engine changes in source, regenerate it.")
    cover["B21"].font = Font(name="Calibri", size=10, italic=True, color="4A5C66")

    sheet = workbook.create_sheet("Report catalogue")
    headers = ["Ref", "Report name", "Catalogue category", "Purpose", "Status", "Engine",
               "Document workflow", "Required before full release", "Filters the engine accepts",
               "Output formats", "Permission", "Source of truth"]
    sheet.append(headers)
    for index, entry in enumerate(rows, start=1):
        if entry["status"] == "available":
            filters = "Period (from, to); facility; account selection; search, as the engine exposes them"
            outputs = "On screen; PDF; Excel where the export is exposed on the result screen"
            status = "Available"
        elif entry["status"] == "existing-document":
            filters = "Defined by the existing document workflow"
            outputs = "Existing document (PDF)"
            status = "Existing document"
        else:
            filters = "Not applicable — no engine"
            outputs = "None"
            status = "Not implemented"
        sheet.append([
            f"RC-{index:03d}", entry["name"], entry["category"], entry["summary"], status,
            entry["engine"], entry["workflow"], entry["dependency"], filters, outputs,
            "reports.read plus the module gate of the report's domain",
            "src/reporting/report-catalogue.ts",
        ])
    style_sheet(sheet, [9, 40, 22, 58, 16, 24, 16, 52, 44, 40, 34, 34])
    sheet.auto_filter.ref = f"A1:L{sheet.max_row}"
    body(sheet)
    for row in sheet.iter_rows(min_row=2, min_col=5, max_col=5):
        cell = row[0]
        colour = {"Available": GREEN, "Existing document": AMBER, "Not implemented": RED}[cell.value]
        cell.fill = PatternFill("solid", fgColor=colour)
        cell.font = Font(name="Calibri", size=10, bold=True)
    add_table(sheet, "ReportCatalogue", len(headers))

    by_cat = workbook.create_sheet("Coverage by category")
    by_cat.append(["Category", "Entries", "Available", "Existing document", "Not implemented"])
    categories = []
    for entry in rows:
        if entry["category"] not in categories:
            categories.append(entry["category"])
    for category in categories:
        subset = [r for r in rows if r["category"] == category]
        by_cat.append([
            category, len(subset),
            sum(1 for r in subset if r["status"] == "available"),
            sum(1 for r in subset if r["status"] == "existing-document"),
            sum(1 for r in subset if r["status"] == "unavailable"),
        ])
    by_cat.append(["Total", len(rows), counts.get("available", 0),
                   counts.get("existing-document", 0), counts.get("unavailable", 0)])
    style_sheet(by_cat, [40, 12, 12, 18, 18])
    body(by_cat)
    for cell in by_cat[by_cat.max_row]:
        cell.font = Font(name="Calibri", bold=True, size=10)
    add_table(by_cat, "CoverageByCategory", 5)

    engine_sheet = workbook.create_sheet("Engines implemented")
    engine_sheet.append(["Engine", "Reports served", "Route"])
    grouped: dict[str, list[str]] = {}
    for entry in rows:
        if entry["engine"]:
            grouped.setdefault(entry["engine"], []).append(entry["name"])
    for engine, names in sorted(grouped.items()):
        engine_sheet.append([engine, len(names), "POST /api/reports/:reportId/generate"])
    style_sheet(engine_sheet, [30, 16, 48])
    body(engine_sheet)
    add_table(engine_sheet, "Engines", 3)

    out = DOCS / "SYRONA_REPORT_CATALOGUE.xlsx"
    workbook.save(out)
    print("wrote", out.relative_to(ROOT), "rows:", len(rows), "engines:", len(grouped))


TRACEABILITY = [
    ("R-01", "Describe the actual repository and running application, not generic healthcare text",
     "All chapters; Ch29 §29.7", "Source paths cited per chapter; captures of the running build", "Met"),
    ("R-02", "Complete system documentation as one volume", "SYRONA_COMPLETE_SYSTEM_DOCUMENTATION.docx",
     "29 chapters plus evidence appendix", "Met"),
    ("R-03", "Separate user manual", "SYRONA_USER_MANUAL.docx", "Operator edition of the module chapters", "Met"),
    ("R-04", "Separate technical manual", "SYRONA_TECHNICAL_MANUAL.docx",
     "Architecture, data, reporting, security, deployment, verification", "Met"),
    ("R-05", "Test and verification report", "SYRONA_TEST_AND_VERIFICATION_REPORT.docx",
     "Ch27 register, Ch28 completion register, evidence appendix", "Met"),
    ("R-06", "Architecture chapter with diagrams", "Ch2", "Figures 2.1 and 2.2; dependency table", "Met"),
    ("R-07", "Every dashboard KPI explained with its source", "Ch4", "Table 4.1", "Met"),
    ("R-08", "Clinical chapters 5–13", "Ch5–Ch13", "Captures plus schema references", "Partial"),
    ("R-09", "Billing chapter distinguishing pharmacy and facility tariffs", "Ch14", "Table 14.1", "Met"),
    ("R-10", "Accounting and GL with debit and credit worked examples", "Ch15", "Worked examples 1 and 2", "Met"),
    ("R-11", "Financial statements with each figure's derivation", "Ch16", "Derivation table and verified totals", "Met"),
    ("R-12", "Partners' equity chapter", "Ch17", "Per-partner table and reconciliation", "Met"),
    ("R-13", "Payroll with effective dates and no legality claim", "Ch18", "Statutory version table", "Met"),
    ("R-14", "Fixed assets with depreciation examples and commencement convention", "Ch19",
     "X-ray worked example", "Met"),
    ("R-15", "Inventory and procurement", "Ch20", "Event-to-ledger table and sequence", "Met"),
    ("R-16", "HR and workforce", "Ch21", "Screens and absence table", "Met"),
    ("R-17", "Insurance and integrations without credentials", "Ch22", "Provider status table", "Met"),
    ("R-18", "Reporting centre with full report catalogue", "Ch23; SYRONA_REPORT_CATALOGUE.xlsx",
     "144 entries; 24 available; 20 engines", "Met"),
    ("R-19", "Administration and configuration", "Ch24", "Configuration tabs and permissions", "Met"),
    ("R-20", "Security, privacy and audit without unproven compliance claims", "Ch25",
     "Control table and explicit non-claims", "Met"),
    ("R-21", "Deployment and maintenance", "Ch26", "Requirements, migrations, backup, troubleshooting", "Met"),
    ("R-22", "Testing chapter with Test ID, scenario, preconditions, steps, expected, actual, result, "
             "evidence, date, environment", "Ch27",
     "Test register with results; environment in §27.2; date per run", "Met"),
    ("R-23", "Known limitations and completion register", "Ch28", "Classified register", "Met"),
    ("R-24", "Glossary, references and revision history", "Ch29", "Term tables and revision table", "Met"),
    ("R-25", "16 process diagrams distinguishing intent from evidence", "Ch2–Ch23; assets/diagrams",
     "16 PNG diagrams with captions", "Met"),
    ("R-26", "Genuine screenshots organised by module, with captions", "assets/screenshots; chapter figures",
     "88 images; provenance file", "Partial"),
    ("R-27", "Five-step workflow sequences", "Ch6, Ch14, Ch17, Ch20, Ch23",
     "Table per sequence with figure references", "Partial"),
    ("R-28", "Cover, TOC, heading styles, page numbers, headers and footers", "All .docx files",
     "Generated with real styles and fields", "Met"),
    ("R-29", "Numbered tables and figures", "All chapters", "Figure captions and chapter-numbered tables", "Met"),
    ("R-30", "Numerical examples formula → inputs → calculation → result, labelled synthetic",
     "Ch14–Ch19", "Worked examples", "Met"),
    ("R-31", "Git safety and a final delivery report", "Delivery report", "Branch, commit, tree, upstream, push", "Met"),
    ("R-32", "No credentials, patient data or fabricated evidence", "All deliverables",
     "Synthetic identifiers only; secret scan before delivery", "Met"),
]

CHAPTERS = [
    ("1", "Introduction", "Capability map; repository facts"),
    ("2", "System architecture", "Architecture and auth diagrams"),
    ("3", "Login, authentication and user management", "Login capture; permission seed"),
    ("4", "Dashboard and notifications", "Dashboard captures; KPI source table"),
    ("5", "Patient management", "Patient captures; schema columns"),
    ("6", "Reception and outpatient department", "Reception and OPD captures"),
    ("7", "Inpatient and ward management", "Schema and permission table; no capture"),
    ("8", "Laboratory", "Workspace captures; order states"),
    ("9", "Radiology", "Workspace and consent captures"),
    ("10", "Pharmacy", "Stock movement table; no capture"),
    ("11", "Maternity and maternal-child health", "Endpoint inventory; no capture"),
    ("12", "Operating theatre", "Limits table; no capture"),
    ("13", "Dialysis", "Session fields; no capture"),
    ("14", "Billing and revenue", "Billing captures; tariff comparison"),
    ("15", "Accounting and the general ledger", "Chart, periods, journals, banking"),
    ("16", "Financial statements", "Statements; verified totals"),
    ("17", "Partners' equity", "Eight captures; 24/24 verification"),
    ("18", "Payroll and statutory deductions", "Six payroll captures"),
    ("19", "Fixed assets and depreciation", "Five asset captures"),
    ("20", "Inventory and procurement", "Nine captures"),
    ("21", "Human resources and workforce", "Four HR captures"),
    ("22", "Insurance and integrations", "SHA and private insurer captures"),
    ("23", "Reporting centre", "Seven reporting captures"),
    ("24", "Administration and configuration", "Configuration captures"),
    ("25", "Security, privacy and audit", "Audit captures; non-claims"),
    ("26", "Deployment and maintenance", "Entry points; migrations; troubleshooting"),
    ("27", "Testing and verification", "Test register and artifacts"),
    ("28", "Known limitations and completion register", "Register"),
    ("29", "Glossary and reference", "Term tables and revision history"),
]

OPEN_ITEMS = [
    ("G-01", "Live M-Pesa, SHA and bank integrations were not exercised: no credentials and no provider "
             "connectivity from the build environment.", "Integrations",
     "Recorded as BLOCKED in Ch27 §27.10 and partial in Ch28 §28.3."),
    ("G-02", "116 catalogue reports have no engine and cannot be exported.", "Reporting",
     "Listed individually in SYRONA_REPORT_CATALOGUE.xlsx and Ch23 §23.2."),
    ("G-03", "Six automated tests fail because the radiology consent gate is stricter than older "
             "billing tests assume; twelve further failures were not retriaged.", "Engineering",
     "Named with their messages in Ch27 §27.5; billing with radiology marked not verified."),
    ("G-04", "The annual statement PDF export reported a signature mismatch; the fix was not re-verified.",
     "Engineering", "Recorded as a FAIL in Ch27 §27.8 (E2E-10) and partial in Ch28 §28.3."),
    ("G-05", "No browser harness was available at the end of the issue, so screenshots come from "
             "recorded acceptance runs rather than fresh captures.", "Documentation",
     "Each image's origin is in docs/documentation/SCREENSHOT_PROVENANCE.md; Ch28 §28.6 records it."),
    ("G-06", "PACS/DICOM, SMS/email delivery, KHIS transmission, training/appraisal/recruitment, "
             "MFA enrolment and field-level encryption are absent.", "Product",
     "Listed under Not implemented, Ch28 §28.5."),
    ("G-07", "No load, penetration or restore drill was performed for this issue.", "Security / operations",
     "Stated in Ch27 §27.10; no capacity or assurance figures are quoted anywhere."),
]


def build_traceability() -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Traceability matrix"
    sheet.append(["Ref", "Requirement (as issued)", "Where answered", "Evidence", "Status"])
    for row in TRACEABILITY:
        sheet.append(list(row))
    style_sheet(sheet, [8, 62, 34, 54, 10])
    body(sheet)
    for row in sheet.iter_rows(min_row=2, min_col=5, max_col=5):
        cell = row[0]
        colour = GREEN if cell.value == "Met" else AMBER if cell.value == "Partial" else RED
        cell.fill = PatternFill("solid", fgColor=colour)
    sheet.auto_filter.ref = f"A1:E{sheet.max_row}"
    add_table(sheet, "Traceability", 5)

    chapters = workbook.create_sheet("Chapter index")
    chapters.append(["Chapter", "Title", "Primary evidence", "Figures", "Tables"])
    for number, title, evidence in CHAPTERS:
        figures, tables = count_assets(number)
        chapters.append([number, title, evidence, figures, tables])
    style_sheet(chapters, [10, 46, 54, 10, 10])
    body(chapters)

    gaps = workbook.create_sheet("Open items")
    gaps.append(["Ref", "Open item", "Owner", "Effect on this issue"])
    for row in OPEN_ITEMS:
        gaps.append(list(row))
    style_sheet(gaps, [8, 66, 20, 62])
    body(gaps)
    add_table(gaps, "OpenItems", 4)

    out = DOCS / "SYRONA_DOCUMENTATION_TRACEABILITY_MATRIX.xlsx"
    workbook.save(out)
    print("wrote", out.relative_to(ROOT), "requirements:", len(TRACEABILITY))


def count_assets(chapter: str) -> tuple[int, int]:
    pattern = re.compile(rf"^# Chapter {chapter} —", re.M)
    for path in sorted((ROOT / "docs/documentation/source").glob("*.md")):
        text = path.read_text()
        match = pattern.search(text)
        if not match:
            continue
        section = text[match.start():]
        following = re.search(r"^# Chapter \d+ —", section[10:], re.M)
        if following:
            section = section[: following.start() + 10]
        figures = len(re.findall(r"^!\[Figure", section, re.M))
        tables = sum(1 for block in section.split("\n\n") if block.strip().startswith("|") and "---" in block)
        return figures, tables
    return 0, 0


if __name__ == "__main__":
    build_report_catalogue()
    build_traceability()

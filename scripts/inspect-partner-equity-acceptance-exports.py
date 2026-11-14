"""Inspect downloaded equity acceptance exports; requires PyMuPDF.

Run at repository root after scripts/partner-equity-acceptance.mjs.
Optional EQUITY_SOURCE_SCREENSHOT verifies the original image SHA256 as well.
"""

import csv
import hashlib
import json
import os
from decimal import Decimal
from pathlib import Path

import pymupdf

root = Path.cwd()
out = root / "docs/audits/partner-equity-acceptance-evidence"
source = json.loads((root / "scripts/fixtures/partner-equity-source-baseline.json").read_text())
checks = []


def check(value, label):
    if not value:
        raise AssertionError(label)
    checks.append({"operation": label, "status": "PASS"})
    print("PASS", label)


def formatted(key, value):
    return f"{Decimal(value):.2f}%" if key in ("sharing", "ownership") else f"{Decimal(value):,.2f}"


if os.environ.get("EQUITY_SOURCE_SCREENSHOT"):
    check(
        hashlib.sha256(Path(os.environ["EQUITY_SOURCE_SCREENSHOT"]).read_bytes()).hexdigest()
        == source["sourceSha256"],
        "Supplied screenshot hash matches source transcription provenance",
    )

with (out / "02-edited-saved-zero.csv").open(encoding="utf-8", newline="") as handle:
    rows = list(csv.reader(handle))
check(
    rows[3][1] == "0.00" and rows[3][2] == "—"
    and rows[2][1] == "1133123.45" and rows[7][6] == "-2353000.00",
    "Actual edited CSV preserves saved edits, explicit zero and unspecified dash",
)
with (out / "05-approved-baseline.csv").open(encoding="utf-8", newline="") as handle:
    rows = list(csv.reader(handle))
check(
    len(rows) >= 15 and all(len(row) == 7 for row in rows[:15]),
    "Approved CSV has all seven columns and fourteen financial rows",
)
check(
    rows[3][1] == "—" and rows[13][6] == "2604695.52",
    "Approved CSV reflects restored SAVED baseline, not earlier unsaved/edited values",
)

with pymupdf.open(out / "05-approved-baseline.pdf") as doc:
    text = "\n".join(page.get_text() for page in doc)
    normalized = " ".join(text.split())
    doc[0].get_pixmap(matrix=pymupdf.Matrix(1.4, 1.4)).save(out / "05-approved-baseline-page1.png")
    check(
        "Disposable partners equity acceptance facility" in text
        and "DISPOSABLE EQUITY ACCEPTANCE FACILITY" in text,
        "Actual browser PDF uses only scoped synthetic facility name and letterhead",
    )
    check(
        "APPROVED" in text and "PROVISIONAL" in text and "formula unverified" in text,
        "Actual PDF contains saved approval and explicit provisional depreciation warning",
    )
    check(
        "Independently reconcile screenshot amounts and accept documented provisional proportional rules"
        in normalized,
        "Actual PDF retains the recorded independent provisional review explanation",
    )
    check(
        "2025-07-01 to 2026-06-30" in text and "2026" in text,
        "PDF preserves source reporting dates and financial year",
    )
    keys = list(source["rows"])
    for i, name in enumerate(source["partners"]):
        section = text.split(name, 1)[1]
        if i + 1 < len(source["partners"]):
            section = section.split(source["partners"][i + 1], 1)[0]
        expected = [
            formatted(key, source["rows"][key][i])
            for key in keys if source["rows"][key][i] is not None
        ]
        check(
            all(value in section for value in expected)
            and section.count("—") >= sum(source["rows"][key][i] is None for key in keys),
            "PDF per-partner section retains every numeric value and unspecified amount for " + name,
        )
    totals = text.split("Formula Audit")[0]
    check(
        all(
            formatted(key, source["rows"][key][-1]) in totals
            for key in keys if source["rows"][key][-1] is not None
        ),
        "PDF summary retains every numeric source total",
    )
    check(
        all(f"Page {i + 1} of {len(doc)}" in page.get_text() for i, page in enumerate(doc)),
        "Every PDF page is numbered",
    )
    inspection = {
        "checks": checks,
        "pdfPages": len(doc),
        "pdfBytes": (out / "05-approved-baseline.pdf").stat().st_size,
        "syntheticOnly": True,
    }
(out / "export-inspection.json").write_text(json.dumps(inspection, indent=2) + "\n")

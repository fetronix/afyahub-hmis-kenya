#!/usr/bin/env python3
"""Draws the sixteen documentation diagrams.

These are explanatory drawings prepared for this document, not screenshots. Each
box names a screen, a record or a component that exists in the repository, and
each caption in the chapters says whether the diagram describes the intended
process or an evidenced one.
"""
from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw, ImageFont

OUT = pathlib.Path("docs/documentation/assets/diagrams")
OUT.mkdir(parents=True, exist_ok=True)

W, H = 1800, 1000
INK = (23, 43, 58)
TEAL = (13, 92, 99)
TEAL_LIGHT = (226, 240, 241)
ACCENT = (176, 84, 24)
GREY = (110, 124, 133)
WHITE = (255, 255, 255)
PAPER = (250, 250, 248)
FONT_DIR = "/usr/share/fonts/truetype/dejavu"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(f"{FONT_DIR}/{name}", size)


def canvas(title: str, subtitle: str):
    image = Image.new("RGB", (W, H), PAPER)
    draw = ImageDraw.Draw(image)
    draw.rectangle([0, 0, W, 96], fill=TEAL)
    draw.text((48, 26), title, font=font(34, True), fill=WHITE)
    if subtitle:
        draw.text((48, 68), subtitle, font=font(18), fill=(214, 233, 235))
    return image, draw


def wrap(draw, text, fnt, width):
    lines, current = [], ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=fnt) <= width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def box(draw, xy, text, *, fill=TEAL_LIGHT, border=TEAL, size=20, bold=False):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle(xy, radius=14, fill=fill, outline=border, width=3)
    fnt = font(size, bold)
    lines = wrap(draw, text, fnt, x1 - x0 - 28)
    step = size + 8
    y = y0 + (y1 - y0 - len(lines) * step) / 2
    for line in lines:
        width = draw.textlength(line, font=fnt)
        draw.text(((x0 + x1 - width) / 2, y), line, font=fnt, fill=INK)
        y += step


def arrow(draw, start, end, colour=TEAL):
    draw.line([start, end], fill=colour, width=4)
    (x0, y0), (x1, y1) = start, end
    if abs(x1 - x0) >= abs(y1 - y0):
        d = 1 if x1 > x0 else -1
        head = [(x1, y1), (x1 - 18 * d, y1 - 9), (x1 - 18 * d, y1 + 9)]
    else:
        d = 1 if y1 > y0 else -1
        head = [(x1, y1), (x1 - 9, y1 - 18 * d), (x1 + 9, y1 - 18 * d)]
    draw.polygon(head, fill=colour)


def flow(name, title, subtitle, steps, *, columns=4, note=None):
    rows = (len(steps) + columns - 1) // columns
    height = 170 + rows * 300 + (rows - 1) * 90 + (130 if note else 60)
    image = Image.new("RGB", (W, height), PAPER)
    draw = ImageDraw.Draw(image)
    draw.rectangle([0, 0, W, 96], fill=TEAL)
    draw.text((48, 26), title, font=font(34, True), fill=WHITE)
    draw.text((48, 68), subtitle, font=font(18), fill=(214, 233, 235))

    margin_x, margin_y, gap_x, gap_y = 70, 160, 46, 90
    cell_w = (W - 2 * margin_x - gap_x * (columns - 1)) / columns
    cell_h = 300
    positions = []
    for index in range(len(steps)):
        row, col = divmod(index, columns)
        if row % 2 == 1:
            col = columns - 1 - col
        x0 = margin_x + col * (cell_w + gap_x)
        y0 = margin_y + row * (cell_h + gap_y)
        positions.append((x0, y0, x0 + cell_w, y0 + cell_h))
        box(draw, positions[-1], steps[index], size=20)
    for index in range(len(steps) - 1):
        a, b = positions[index], positions[index + 1]
        if abs(a[1] - b[1]) < 5:
            mid = (a[1] + a[3]) / 2
            if b[0] > a[0]:
                arrow(draw, (a[2], mid), (b[0] - 4, mid))
            else:
                arrow(draw, (a[0], mid), (b[2] + 4, mid))
        else:
            arrow(draw, ((a[0] + a[2]) / 2, a[3]), ((b[0] + b[2]) / 2, b[1] - 4))
    for number, (x0, y0, _x1, _y1) in enumerate(positions, start=1):
        draw.ellipse([x0 + 12, y0 + 12, x0 + 44, y0 + 44], fill=TEAL, outline=WHITE, width=2)
        label = str(number)
        width = draw.textlength(label, font=font(17, True))
        draw.text((x0 + 28 - width / 2, y0 + 17), label, font=font(17, True), fill=WHITE)
    if note:
        draw.rectangle([0, height - 106, W, height], fill=(240, 238, 232))
        y = height - 88
        for line in wrap(draw, note, font(18), W - 120):
            draw.text((60, y), line, font=font(18), fill=INK)
            y += 26
    image.save(OUT / f"{name}.png", optimize=True)
    print("diagram:", name)


def architecture():
    image, draw = canvas(
        "System architecture",
        "One Node process serves the API and the built client; PostgreSQL holds every record",
    )
    layers = [
        ("Browser", "React 18 SPA · session token · permission-aware navigation", TEAL_LIGHT),
        ("Security middleware", "headers · CORS · body limits · rate limits · correlation id", (240, 244, 246)),
        ("Authentication", "auth_sessions · 8-hour expiry · revocation · security version", (240, 244, 246)),
        ("Authorization", "226 permissions · tenant and facility scope · module gates · separation of duties", (240, 244, 246)),
        ("Domain routers", "57 route files · 571 handlers · validation · domain services", TEAL_LIGHT),
        ("PostgreSQL 16", "108 migrations · append-only audit_logs · open-period posting", (232, 238, 230)),
    ]
    y = 140
    for index, (heading, detail, fill) in enumerate(layers):
        draw.rounded_rectangle([150, y, W - 150, y + 104], radius=14, fill=fill, outline=TEAL, width=3)
        draw.text((178, y + 18), heading, font=font(24, True), fill=INK)
        draw.text((178, y + 56), detail, font=font(18), fill=(60, 78, 90))
        if index < len(layers) - 1:
            arrow(draw, (W / 2, y + 104), (W / 2, y + 132))
        y += 132
    draw.text((60, 140), "Client", font=font(16, True), fill=TEAL)
    draw.text((60, 272), "API", font=font(16, True), fill=TEAL)
    draw.text((60, 800), "Data", font=font(16, True), fill=TEAL)
    draw.text((150, 962), "PDF, Excel and Word exports render inside the same Node process; there is no separate worker.",
              font=font(17), fill=GREY)
    image.save(OUT / "architecture.png", optimize=True)
    print("diagram: architecture")


def permission_flow():
    image, draw = canvas(
        "Authentication and permission flow",
        "Every request is authenticated, authorised, gated by the facility's modules, then audited",
    )
    steps = [
        ("Sign in", "identifier + password"),
        ("Session issued", "token · 8 hours"),
        ("Request", "Authorization: Bearer"),
        ("Session valid?", "expiry · revocation"),
        ("Permission held?", "role + override"),
        ("Module enabled?", "facility gate"),
        ("Handler runs", "facility-scoped query"),
        ("Audit record", "actor · action · time"),
    ]
    y = 220
    width = (W - 140 - 7 * 26) / 8
    boxes = []
    for index, (head, detail) in enumerate(steps):
        x0 = 70 + index * (width + 26)
        boxes.append((x0, y, x0 + width, y + 190))
        box(draw, boxes[-1], head, size=17, bold=True)
        draw.text((x0 + 14, y + 150), detail, font=font(14), fill=GREY)
        if index:
            arrow(draw, (boxes[index - 1][2], y + 95), (x0 - 4, y + 95))
    box(draw, (150, 560, 860, 660),
        "Refused: 401 unauthenticated · 403 unauthorised · module not enabled",
        fill=(250, 233, 226), border=ACCENT, size=19)
    for index in (3, 4, 5):
        arrow(draw, ((boxes[index][0] + boxes[index][2]) / 2, y + 190), (400 + 160 * (index - 3), 560), colour=ACCENT)
    draw.text((150, 700), "A refusal is logged, and it never returns another facility's data.", font=font(18), fill=INK)
    image.save(OUT / "auth-permission-flow.png", optimize=True)
    print("diagram: auth-permission-flow")


def patient_journey():
    image, draw = canvas("Patient journey", "Registration to settlement, and the records created along the way")
    stages = [
        ("Registration", "patient · MRN · payer"),
        ("Reception", "visit · queue"),
        ("Consultation", "encounter · diagnosis"),
        ("Orders", "lab · radiology · pharmacy"),
        ("Results", "verified · released"),
        ("Billing", "invoice · payment · receipt"),
        ("Follow-up", "appointment · portal"),
    ]
    y = 300
    width = (W - 140 - 6 * 24) / 7
    previous = None
    for index, (head, detail) in enumerate(stages):
        x0 = 70 + index * (width + 24)
        rect = (x0, y, x0 + width, y + 210)
        box(draw, rect, head, size=19, bold=True)
        draw.text((x0 + 14, y + 160), detail, font=font(14), fill=GREY)
        if previous:
            arrow(draw, (previous[2], y + 105), (x0 - 4, y + 105))
        previous = rect
    draw.rectangle([70, 640, W - 70, 800], fill=(240, 244, 240), outline=(200, 210, 200))
    draw.text((100, 668), "One patient record, one tenant", font=font(22, True), fill=TEAL)
    draw.text((100, 714),
              "Encounters, orders, results, invoices and documents are rows attached to the patient; no module keeps "
              "a private copy of the patient's identity.", font=font(18), fill=INK)
    image.save(OUT / "patient-journey.png", optimize=True)
    print("diagram: patient-journey")


WORKFLOWS = [
    ("opd-workflow", "Outpatient workflow", "Check-in to follow-up, with the record each step creates", [
        "Patient arrives or books an appointment",
        "Reception confirms the patient and the payer",
        "Visit opened; queue entry created",
        "Clinician calls the patient and records vitals",
        "Consultation note written",
        "Diagnosis recorded against the encounter",
        "Laboratory, radiology and pharmacy orders raised",
        "Charges raised on the patient invoice",
        "Visit closed; follow-up offered",
    ], 5, "Screens: reception, outpatient workspace, encounter detail. Data path evidenced by the clinical acceptance suites."),

    ("laboratory-workflow", "Laboratory workflow", "Order to released result", [
        "Clinician orders tests",
        "Service charge raised at order time",
        "Specimen collected and accessioned",
        "Order moves to processing",
        "Result entered against the test",
        "Result checked against its reference range",
        "Second user verifies the result",
        "Result visible to the requesting clinician",
    ], 4, "Verification requires laboratory.result.verify held by a different user from the one who entered the result."),

    ("radiology-workflow", "Radiology workflow", "Request to report release", [
        "Clinician requests an examination",
        "Charge raised; consent required",
        "Consent recorded with its document",
        "Examination performed",
        "Images uploaded as patient documents",
        "Radiologist writes the report",
        "Report verified",
        "Report released to the portal",
    ], 4, "No PACS/DICOM integration exists in this build: images are uploaded files, not a study archive."),

    ("pharmacy-workflow", "Pharmacy workflow", "Prescription to stock movement and revenue", [
        "Prescription appears in the pharmacy queue",
        "Pharmacist checks stock and expiry",
        "Batch selected, earliest expiry first",
        "Dispensation recorded against the prescription",
        "Batch quantity reduced as a stock movement",
        "Charge added to the patient invoice",
        "Receipt issued",
        "Return or adjustment recorded if needed",
    ], 4, "Pharmacy prices come from the medicine catalogue; facility services come from the service tariff — two different records."),

    ("inpatient-workflow", "Inpatient admission and discharge", "Admission to bed release, including daily charging", [
        "Admission decision recorded",
        "Ward and bed selected",
        "Bed occupied; admission opened",
        "Nursing notes and observations recorded",
        "Daily ward charge accrued",
        "Transfer if the clinical need changes",
        "Discharge summary written",
        "Final day charged; bed released",
        "Outstanding balance presented to the cashier",
    ], 5, "Discharge does not write off an unpaid balance: the invoice stays outstanding and visible on the billing worklist."),

    ("invoice-payment", "Invoice to payment", "Why revenue is posted once and cash is posted separately", [
        "Service or medicine becomes a charge",
        "Invoice line created",
        "Invoice finalised",
        "Revenue and receivable posted",
        "Payment received",
        "Receipt issued",
        "Cash or bank posted against the receivable",
        "Receivable balance recomputed",
    ], 4, "Settling a receivable is not revenue. Posting a receipt to income double-counts the sale."),

    ("payroll-workflow", "Payroll calculation and posting", "Effective-dated rules, review, approval, posting", [
        "Employee and salary structure",
        "Payroll run created for a period",
        "Gross pay computed from components",
        "Statutory versions in force selected",
        "PAYE, NSSF, SHIF and AHL computed",
        "Employer contributions computed",
        "Second-user review",
        "Approval by an authorised user",
        "Journal posted; payslips generated",
    ], 5, "A run is refused when no verified, active statutory version covers the period. The application does not certify rates."),

    ("monthly-close", "Monthly accounting close", "From sub-ledgers to a reviewed statement run", [
        "Post the month's clinical charges and cash",
        "Post supplier invoices and payments",
        "Post payroll and statutory liabilities",
        "Post depreciation for the month",
        "Reconcile bank and cash accounts",
        "Review the trial balance",
        "Report or resolve differences",
        "Generate the monthly statements",
        "Review and approve the run",
    ], 5, "A difference is reported for authorised review; no balancing journal is inserted to force agreement."),

    ("annual-close", "Annual accounting close", "Financial year as configured per facility (July–June in the synthetic facility)", [
        "Confirm the financial-year start month",
        "Close the last open period of the year",
        "Post year-end adjustments",
        "Allocate profit or loss to partners",
        "Reconcile each partner to the ledger",
        "Generate the annual statements",
        "Generate prior-year comparatives",
        "Review, approve and archive",
        "Open the new year's periods",
    ], 5, "The statement of changes in partners' equity must reconcile to the capital and drawings control accounts before approval."),

    ("partner-capital", "Partners' capital movement", "Every movement is approved and posted; nothing is edited after posting", [
        "Partner created, pending approval",
        "Second user approves the terms",
        "Contribution recorded as a draft",
        "A different user approves and posts",
        "Balanced journal posted to the ledger",
        "Statement shows the running balance",
        "Reversal creates an offsetting journal",
        "Per-partner reconciliation to control accounts",
    ], 4, "Closing = opening + contributions + profit − loss − drawings ± adjustments. No equal-split assumption and no plug."),

    ("procurement-workflow", "Procurement to payment", "Requisition to supplier settlement", [
        "Department raises a requisition",
        "Approver accepts or rejects",
        "Purchase order issued",
        "Goods received (GRN, batch, expiry)",
        "Inventory and payable posted",
        "Supplier invoice matched to order and receipt",
        "Exceptions approved",
        "Payment made against the payable",
    ], 4, "A purchase order is a commitment. The liability arises on receipt and invoice matching, not on ordering."),

    ("asset-lifecycle", "Fixed asset lifecycle", "Acquisition to disposal, with the ledger entry at each stage", [
        "Asset requested and approved",
        "Acquisition recorded (cost, supplier)",
        "Asset cost and payable posted",
        "Depreciation starts the following month",
        "Monthly depreciation posted",
        "Maintenance and inspections recorded",
        "Transfer changes location or custodian",
        "Disposal recorded with proceeds",
        "Gain or loss posted; depreciation stops",
    ], 5, "Depreciation example: 1,200,000 ÷ 60 months = 20,000 per month, first charged in the month after acquisition."),

    ("report-generation", "Report generation", "Catalogue → filters → query → screen → export", [
        "User opens the reporting centre",
        "Selects a report from the catalogue",
        "Catalogue states the implementation status",
        "Filters applied (period, facility, status)",
        "Engine runs a facility-scoped query",
        "Rows returned, or an explicit empty result",
        "Screen restates the filters above the rows",
        "Export the same result to PDF or Excel",
    ], 4, "Of 144 catalogue entries, 24 have an engine; 4 open an existing document workflow; 116 have neither."),
]


def main() -> None:
    architecture()
    permission_flow()
    patient_journey()
    for name, title, subtitle, steps, columns, note in WORKFLOWS:
        flow(name, title, subtitle, steps, columns=columns, note=note)


if __name__ == "__main__":
    main()

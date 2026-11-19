#!/usr/bin/env python3
"""Builds the Word deliverables from the Markdown chapters in docs/documentation/source.

One Markdown source, four documents:

* JALICARE_COMPLETE_SYSTEM_DOCUMENTATION.docx — all chapters and the appendix
* JALICARE_USER_MANUAL.docx — operator edition
* JALICARE_TECHNICAL_MANUAL.docx — architecture, accounting engine, reporting,
  security, deployment and verification
* JALICARE_TEST_AND_VERIFICATION_REPORT.docx — test register, completion
  register and evidence appendix

Every figure is a real file on disk. If an image is missing the build fails
rather than inserting a placeholder.
"""
from __future__ import annotations

import pathlib
import re

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Emu, Inches, Pt, RGBColor
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/documentation/source"
OUT = ROOT / "docs"

INK = RGBColor(0x17, 0x2B, 0x2E)
TEAL = RGBColor(0x0D, 0x5C, 0x63)
GREY = RGBColor(0x5A, 0x6B, 0x73)

TEAL_HEX = "0D5C63"
BAND_HEX = "F5F2EA"
LINE_HEX = "C9D6D8"

BODY_FONT = "Calibri"
MONO_FONT = "Consolas"
MAX_IMAGE_WIDTH = Inches(6.3)
CONTENT_WIDTH_CM = 16.2

CHAPTER_RE = re.compile(r"^# Chapter (\d+) — (.+)$", re.M)
FIGURE_RE = re.compile(r"^!\[(.*?)\]\((.*?)\)\s*$")


def set_cell_shading(cell, hex_colour: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_colour)
    tc_pr.append(shd)


def set_cell_margins(cell, top=60, bottom=60, left=90, right=90) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    mar = OxmlElement("w:tcMar")
    for name, value in (("top", top), ("bottom", bottom), ("start", left), ("end", right)):
        node = OxmlElement(f"w:{name}")
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")
        mar.append(node)
    tc_pr.append(mar)


def set_row_cant_split(row) -> None:
    row._tr.get_or_add_trPr().append(OxmlElement("w:cantSplit"))


def set_repeat_header(row) -> None:
    row._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))


def set_table_borders(table, colour=LINE_HEX, size=4) -> None:
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        element = OxmlElement(f"w:{edge}")
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), str(size))
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), colour)
        borders.append(element)
    table._tbl.tblPr.append(borders)


def add_field(paragraph, instruction: str, placeholder: str = "") -> None:
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = f" {instruction} "
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = placeholder
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    for node in (begin, instr, separate, text, end):
        run._r.append(node)


def add_bookmark(paragraph, name: str, bookmark_id: int) -> None:
    start = OxmlElement("w:bookmarkStart")
    start.set(qn("w:id"), str(bookmark_id))
    start.set(qn("w:name"), name)
    end = OxmlElement("w:bookmarkEnd")
    end.set(qn("w:id"), str(bookmark_id))
    paragraph._p.insert(0, start)
    paragraph._p.append(end)


def shade_paragraph(paragraph, hex_colour: str) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_colour)
    p_pr.append(shd)


def border_paragraph(paragraph, *, left=None, bottom=None) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    borders = OxmlElement("w:pBdr")
    for edge, spec in (("left", left), ("bottom", bottom)):
        if not spec:
            continue
        element = OxmlElement(f"w:{edge}")
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), str(spec[0]))
        element.set(qn("w:space"), "6")
        element.set(qn("w:color"), spec[1])
        borders.append(element)
    p_pr.append(borders)


class Manual:
    def __init__(self, *, doc_id: str, title: str, subtitle: str, audience: str,
                 description: str, scope_note: str):
        self.doc_id = doc_id
        self.title = title
        self.subtitle = subtitle
        self.audience = audience
        self.description = description
        self.scope_note = scope_note
        self.doc = Document()
        self.bookmark_id = 100
        self.chapter_no: int | None = None
        self.table_count = 0
        self.section_title = ""
        self.figures: list[str] = []
        self.tables: list[str] = []
        self._setup_styles()
        self._setup_page()

    def _setup_styles(self) -> None:
        styles = self.doc.styles
        normal = styles["Normal"]
        normal.font.name = BODY_FONT
        normal.font.size = Pt(10.5)
        normal.font.color.rgb = INK
        normal.paragraph_format.space_after = Pt(6)
        normal.paragraph_format.line_spacing = 1.12
        normal.paragraph_format.widow_control = True
        rpr = normal.element.get_or_add_rPr()
        fonts = rpr.find(qn("w:rFonts"))
        if fonts is None:
            fonts = OxmlElement("w:rFonts")
            rpr.append(fonts)
        for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
            fonts.set(qn(attr), BODY_FONT)

        def heading(name, size, colour, before, after, *, page_break=False):
            style = styles[name]
            style.font.name = BODY_FONT
            style.font.size = Pt(size)
            style.font.bold = True
            style.font.color.rgb = colour
            style.paragraph_format.space_before = Pt(before)
            style.paragraph_format.space_after = Pt(after)
            style.paragraph_format.keep_with_next = True
            style.paragraph_format.page_break_before = page_break
            if page_break:
                style.paragraph_format.space_before = Pt(0)
            rpr = style.element.get_or_add_rPr()
            fonts = rpr.find(qn("w:rFonts"))
            if fonts is None:
                fonts = OxmlElement("w:rFonts")
                rpr.append(fonts)
            for attr in ("w:ascii", "w:hAnsi", "w:cs"):
                fonts.set(qn(attr), BODY_FONT)

        heading("Heading 1", 22, TEAL, 0, 14, page_break=True)
        heading("Heading 2", 14.5, TEAL, 16, 6)
        heading("Heading 3", 11.5, INK, 12, 4)

        for name in ("List Bullet", "List Number"):
            style = styles[name]
            style.font.name = BODY_FONT
            style.font.size = Pt(10.5)
            style.paragraph_format.space_after = Pt(3)

        for caption in ("Figure Caption", "Table Caption"):
            style = styles.add_style(caption, 1)
            style.font.name = BODY_FONT
            style.font.size = Pt(9)
            style.font.italic = True
            style.font.color.rgb = GREY
            style.paragraph_format.space_before = Pt(3)
            style.paragraph_format.space_after = Pt(10)
            style.paragraph_format.keep_with_next = caption == "Table Caption"
            style.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER

        settings = self.doc.settings.element
        update = OxmlElement("w:updateFields")
        update.set(qn("w:val"), "true")
        settings.append(update)

    def _setup_page(self) -> None:
        section = self.doc.sections[0]
        section.page_height = Cm(29.7)
        section.page_width = Cm(21.0)
        section.top_margin = Cm(2.4)
        section.bottom_margin = Cm(2.2)
        section.left_margin = Cm(2.4)
        section.right_margin = Cm(2.4)
        section.header_distance = Cm(1.1)
        section.footer_distance = Cm(1.0)
        section.different_first_page_header_footer = True

    def _header_footer(self) -> None:
        section = self.doc.sections[0]
        paragraph = section.header.paragraphs[0]
        paragraph.text = ""
        paragraph.paragraph_format.tab_stops.add_tab_stop(Cm(CONTENT_WIDTH_CM), WD_TAB_ALIGNMENT.RIGHT)
        left = paragraph.add_run(self.title)
        left.font.size = Pt(8)
        left.font.color.rgb = GREY
        paragraph.add_run("\t")
        right = paragraph.add_run(f"JaliCare HMIS · {self.doc_id} · v1.0")
        right.font.size = Pt(8)
        right.font.color.rgb = GREY
        border_paragraph(paragraph, bottom=(6, LINE_HEX))

        paragraph = section.footer.paragraphs[0]
        paragraph.text = ""
        paragraph.paragraph_format.tab_stops.add_tab_stop(Cm(CONTENT_WIDTH_CM), WD_TAB_ALIGNMENT.RIGHT)
        left = paragraph.add_run("Internal · synthetic demonstration data")
        left.font.size = Pt(8)
        left.font.color.rgb = GREY
        paragraph.add_run("\t")
        page = paragraph.add_run("Page ")
        page.font.size = Pt(8)
        page.font.color.rgb = GREY
        add_field(paragraph, "PAGE", "1")
        of = paragraph.add_run(" of ")
        of.font.size = Pt(8)
        of.font.color.rgb = GREY
        add_field(paragraph, "NUMPAGES", "1")
        for run in paragraph.runs:
            run.font.size = Pt(8)
            run.font.color.rgb = GREY

    def _cover(self) -> None:
        band = self.doc.add_table(rows=1, cols=1)
        band.alignment = WD_TABLE_ALIGNMENT.CENTER
        cell = band.rows[0].cells[0]
        set_cell_shading(cell, TEAL_HEX)
        set_cell_margins(cell, top=380, bottom=380, left=340, right=340)
        cell.width = Cm(CONTENT_WIDTH_CM)
        paragraph = cell.paragraphs[0]
        paragraph.paragraph_format.space_after = Pt(4)
        run = paragraph.add_run("JALICARE HMIS")
        run.font.size = Pt(15)
        run.font.bold = True
        run.font.color.rgb = RGBColor(0xBF, 0xDD, 0xDF)
        paragraph = cell.add_paragraph()
        paragraph.paragraph_format.space_after = Pt(0)
        run = paragraph.add_run(self.title)
        run.font.size = Pt(30)
        run.font.bold = True
        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        paragraph = cell.add_paragraph()
        paragraph.paragraph_format.space_before = Pt(8)
        paragraph.paragraph_format.space_after = Pt(0)
        run = paragraph.add_run(self.subtitle)
        run.font.size = Pt(11)
        run.font.color.rgb = RGBColor(0xDD, 0xEE, 0xEF)

        spacer = self.doc.add_paragraph()
        spacer.paragraph_format.space_after = Pt(14)
        paragraph = self.doc.add_paragraph()
        paragraph.paragraph_format.space_after = Pt(18)
        run = paragraph.add_run(self.description)
        run.font.size = Pt(11.5)
        run.font.color.rgb = INK

        facts = [
            ("Document identifier", self.doc_id),
            ("Version", "1.0"),
            ("Status", "Issued"),
            ("Date", "19 November 2026"),
            ("System", "JaliCare HMIS 0.1.0 (AfyaHub Kenya)"),
            ("Base commit", "0111b5502e1a8d8a21faf53845360122275727df"),
            ("Branch", "arena/e088f11d-afyahub-hmis-kenya"),
            ("Classification", "Internal — facility operations and technical support"),
            ("Audience", self.audience),
            ("Data", "Synthetic only (Syrona Medical Center, synthetic facility)"),
        ]
        table = self.doc.add_table(rows=0, cols=2)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        set_table_borders(table)
        for label, value in facts:
            row = table.add_row()
            set_row_cant_split(row)
            key, val = row.cells
            key.width = Cm(4.6)
            val.width = Cm(11.6)
            set_cell_shading(key, BAND_HEX)
            set_cell_margins(key)
            set_cell_margins(val)
            p = key.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            run = p.add_run(label)
            run.font.size = Pt(9)
            run.font.bold = True
            run.font.color.rgb = TEAL
            p = val.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            run = p.add_run(value)
            run.font.size = Pt(9)

        self.doc.add_paragraph()
        note = self.doc.add_paragraph()
        note.paragraph_format.space_before = Pt(16)
        run = note.add_run(self.scope_note)
        run.font.size = Pt(9)
        run.font.italic = True
        run.font.color.rgb = GREY

    def _front_matter(self) -> None:
        self.doc.add_page_break()
        self._h1_plain("Document control")
        self._kv_table([
            ("Document title", self.title),
            ("Document identifier", self.doc_id),
            ("Version / status", "1.0 · Issued"),
            ("Issue date", "19 November 2026"),
            ("Prepared by", "Engineering documentation task"),
            ("Prepared from", "Repository fetronix/afyahub-hmis-kenya at commit 0111b55, plus the "
                              "recorded verification runs held in this repository"),
            ("Reviewed by", "Not reviewed by a second party at issue"),
            ("Applies to", "JaliCare HMIS 0.1.0, PostgreSQL 16, Node.js 22"),
            ("Supersedes", "None — first issue"),
            ("Related documents", "The other volumes of this package and the two workbooks: "
                                  "report catalogue and traceability matrix"),
        ])

        self._h2("Review record")
        self._table(["Version", "Date", "Author", "Change"],
                    [["1.0", "19 Nov 2026", "Engineering documentation task", "First issue of this volume."]])

        self._h2("How this document was produced")
        for text in (
            "Every statement about implemented behaviour was checked against source code, the "
            "database schema and migrations, or the running application. Where a feature could "
            "not be verified it is marked Not verified or Not implemented rather than described "
            "as working.",
            "Screenshots are browser captures recorded in this repository as acceptance evidence; "
            "their origin is listed in docs/documentation/SCREENSHOT_PROVENANCE.md. Diagrams are "
            "explanatory drawings, and each caption says whether it describes the intended process "
            "or an evidenced one.",
            "Test results are the output of runs executed for this issue against disposable "
            "PostgreSQL databases. No result was written from memory, and the failures that "
            "remain open are listed rather than softened.",
        ):
            self._paragraph(text)

        self._h2("Reading conventions")
        self._table(["Label", "Meaning"], [
            ["Verified", "Observed in the running application and/or asserted by an automated test "
                         "recorded in this volume."],
            ["Implemented, not exercised", "Code, schema and screen exist and render, but no "
                                           "end-to-end run with data was performed for this issue."],
            ["Not implemented", "Absent; the screen or the report catalogue says so."],
            ["Not verified", "No evidence either way. Treated as a gap, never as a capability."],
            ["Synthetic", "Created for demonstration. Never a real patient, employee or facility's accounts."],
        ])
        self._paragraph(
            "Amounts are in Kenya Shillings (KES) unless stated. The database stores money as "
            "integer cents; the interface divides by 100 for display. \"The synthetic facility\" "
            "means Syrona Medical Center (Synthetic), code SYN-SMC-01, tenant "
            "syrona-synthetic-company. Every figure here is synthetic test data and must never be "
            "presented as an audited record."
        )

        self.doc.add_page_break()
        self._h1_plain("Contents")
        self._toc_field()
        self.doc.add_paragraph()
        self._h2("List of figures")
        self._toc_field(kind="Figure Caption")
        self.doc.add_paragraph()
        self._h2("List of tables")
        self._toc_field(kind="Table Caption")
        note = self.doc.add_paragraph()
        run = note.add_run(
            "These three lists are Word fields. Word fills them, with page numbers, when you "
            "accept the update prompt on opening the file, or when you select a list and press "
            "F9. The headings are real heading styles, so the navigation pane works without "
            "updating the fields."
        )
        run.font.size = Pt(9)
        run.font.italic = True
        run.font.color.rgb = GREY

    def _toc_field(self, *, kind: str | None = None) -> None:
        paragraph = self.doc.add_paragraph()
        paragraph.paragraph_format.space_after = Pt(6)
        if kind:
            add_field(paragraph, f'TOC \\h \\z \\t "{kind},1"',
                      f"{kind}s appear here after the fields are updated.")
        else:
            add_field(paragraph, 'TOC \\o "1-3" \\h \\z \\u',
                      "Table of contents appears here after the fields are updated.")

    def _h1_plain(self, text: str):
        paragraph = self.doc.add_paragraph(text, style="Heading 1")
        paragraph.paragraph_format.page_break_before = False
        return paragraph

    def _h2(self, text: str):
        return self.doc.add_paragraph(text, style="Heading 2")

    def _paragraph(self, text: str = ""):
        paragraph = self.doc.add_paragraph()
        self._inline(paragraph, text)
        return paragraph

    def _inline(self, paragraph, text: str, *, size=None) -> None:
        pattern = re.compile(r"(\*\*.+?\*\*|`[^`]+`)")
        for piece in pattern.split(text):
            if not piece:
                continue
            if piece.startswith("**") and piece.endswith("**") and len(piece) > 4:
                run = paragraph.add_run(piece[2:-2])
                run.font.bold = True
            elif piece.startswith("`") and piece.endswith("`") and len(piece) > 2:
                run = paragraph.add_run(piece[1:-1])
                run.font.name = MONO_FONT
                run.font.size = Pt(9)
                run.font.color.rgb = TEAL
            else:
                run = paragraph.add_run(piece)
            if size:
                run.font.size = Pt(size)

    def _kv_table(self, rows: list[tuple[str, str]]) -> None:
        table = self.doc.add_table(rows=0, cols=2)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        set_table_borders(table)
        for label, value in rows:
            row = table.add_row()
            set_row_cant_split(row)
            key, val = row.cells
            key.width = Cm(4.6)
            val.width = Cm(11.6)
            set_cell_shading(key, BAND_HEX)
            for cell in (key, val):
                set_cell_margins(cell)
            p = key.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            run = p.add_run(label)
            run.font.size = Pt(9)
            run.font.bold = True
            run.font.color.rgb = TEAL
            p = val.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            self._inline(p, value)
            for run in p.runs:
                run.font.size = Pt(9)

    def _table(self, header: list[str], rows: list[list[str]]):
        columns = len(header)
        size = 8.5 if columns >= 6 else 9
        table = self.doc.add_table(rows=1, cols=columns)
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = True
        set_table_borders(table)
        head = table.rows[0]
        set_repeat_header(head)
        set_row_cant_split(head)
        for index, text in enumerate(header):
            cell = head.cells[index]
            set_cell_shading(cell, TEAL_HEX)
            set_cell_margins(cell)
            paragraph = cell.paragraphs[0]
            paragraph.paragraph_format.space_after = Pt(0)
            run = paragraph.add_run(text)
            run.font.bold = True
            run.font.size = Pt(size)
            run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        for index, values in enumerate(rows):
            row = table.add_row()
            set_row_cant_split(row)
            for column in range(columns):
                cell = row.cells[column]
                set_cell_margins(cell)
                if index % 2 == 1:
                    set_cell_shading(cell, "F4F7F7")
                paragraph = cell.paragraphs[0]
                paragraph.paragraph_format.space_after = Pt(0)
                paragraph.paragraph_format.line_spacing = 1.0
                self._inline(paragraph, str(values[column]) if column < len(values) else "")
                for run in paragraph.runs:
                    if run.font.size is None or run.font.size > Pt(size):
                        run.font.size = Pt(size)
        weights = []
        for column in range(columns):
            longest = max([len(header[column])] + [len(str(r[column])) for r in rows if column < len(r)])
            weights.append(max(8, min(longest, 48)))
        total = sum(weights)
        for column, weight in enumerate(weights):
            width = Cm(CONTENT_WIDTH_CM * weight / total)
            for row in table.rows:
                row.cells[column].width = width
        self.table_count += 1
        number = f"{self.chapter_no}.{self.table_count}" if self.chapter_no else str(self.table_count)
        label = self.section_title or "Table"
        label = re.sub(r"^\d+(\.\d+)*\s+", "", label).strip()
        label = label[:1].upper() + label[1:] if label else label
        caption = self.doc.add_paragraph(f"Table {number} — {label}", style="Table Caption")
        self.tables.append(f"Table {number} — {label}")
        caption.paragraph_format.space_after = Pt(12)

    def _figure(self, alt: str, path: str) -> None:
        file = ROOT / path
        if not file.exists():
            raise FileNotFoundError(f"figure missing on disk: {path}")
        with Image.open(file) as image:
            width_px, _ = image.size
        width = min(MAX_IMAGE_WIDTH, Emu(int(width_px * 914400 / 96)))
        paragraph = self.doc.add_paragraph()
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        paragraph.paragraph_format.space_before = Pt(8)
        paragraph.paragraph_format.space_after = Pt(2)
        paragraph.paragraph_format.keep_with_next = True
        paragraph.add_run().add_picture(str(file), width=width)
        caption_text = alt.strip()
        match = re.match(r"Figure ([A-Z0-9][\w.]*) — (.*)", caption_text)
        if match:
            number, text = match.groups()
        else:
            number = f"{self.chapter_no}.{len(self.figures) + 1}" if self.chapter_no else "?"
            text = caption_text
        caption = self.doc.add_paragraph(f"Figure {number} — {text}", style="Figure Caption")
        self.figures.append(f"Figure {number} — {text}")
        caption.paragraph_format.space_after = Pt(14)

    def _bullet(self, text: str) -> None:
        paragraph = self.doc.add_paragraph(style="List Bullet")
        self._inline(paragraph, text)

    def _numbered(self, text: str) -> None:
        paragraph = self.doc.add_paragraph(style="List Number")
        self._inline(paragraph, text)

    def _quote(self, text: str) -> None:
        paragraph = self.doc.add_paragraph()
        paragraph.paragraph_format.left_indent = Cm(0.5)
        paragraph.paragraph_format.space_before = Pt(6)
        paragraph.paragraph_format.space_after = Pt(10)
        shade_paragraph(paragraph, BAND_HEX)
        border_paragraph(paragraph, left=(18, TEAL_HEX))
        self._inline(paragraph, text, size=9.5)
        for run in paragraph.runs:
            run.font.color.rgb = GREY

    def _code(self, lines: list[str]) -> None:
        paragraph = self.doc.add_paragraph()
        paragraph.paragraph_format.left_indent = Cm(0.4)
        shade_paragraph(paragraph, "F4F4F2")
        run = paragraph.add_run("\n".join(lines))
        run.font.name = MONO_FONT
        run.font.size = Pt(8.5)

    def body(self, text: str) -> None:
        lines = text.splitlines()
        index = 0
        buffer: list[str] = []
        table_rows: list[list[str]] = []
        table_header: list[str] | None = None

        def flush():
            if buffer:
                self._paragraph(" ".join(part.strip() for part in buffer))
                buffer.clear()

        def flush_table():
            nonlocal table_rows, table_header
            if table_header is not None:
                self._table(table_header, table_rows)
            table_rows = []
            table_header = None

        while index < len(lines):
            line = lines[index].rstrip()
            stripped = line.strip()

            if stripped.startswith("|") and stripped.endswith("|"):
                flush()
                cells = [cell.strip() for cell in stripped.strip("|").split("|")]
                if all(re.fullmatch(r":?-{2,}:?", cell) for cell in cells if cell):
                    index += 1
                    continue
                if table_header is None:
                    table_header = cells
                else:
                    table_rows.append(cells)
                index += 1
                continue
            flush_table()

            if not stripped:
                flush()
                index += 1
                continue

            chapter = CHAPTER_RE.match(line)
            if chapter:
                flush()
                number = int(chapter.group(1))
                self.chapter_no = number
                self.table_count = 0
                self.section_title = chapter.group(2)
                paragraph = self.doc.add_paragraph(line.lstrip("# ").strip(), style="Heading 1")
                add_bookmark(paragraph, f"_chapter_{number}", self.bookmark_id)
                self.bookmark_id += 1
                index += 1
                continue

            if stripped.startswith("### "):
                flush()
                self.section_title = stripped[4:].strip()
                self.doc.add_paragraph(stripped[4:].strip(), style="Heading 3")
                index += 1
                continue
            if stripped.startswith("## "):
                flush()
                self.section_title = stripped[3:].strip()
                self.doc.add_paragraph(stripped[3:].strip(), style="Heading 2")
                index += 1
                continue
            if stripped.startswith("# "):
                flush()
                self.doc.add_paragraph(stripped[2:].strip(), style="Heading 1")
                index += 1
                continue

            figure = FIGURE_RE.match(stripped)
            if figure:
                flush()
                self._figure(figure.group(1), figure.group(2))
                index += 1
                continue

            if stripped.startswith("```"):
                flush()
                block: list[str] = []
                index += 1
                while index < len(lines) and not lines[index].strip().startswith("```"):
                    block.append(lines[index])
                    index += 1
                self._code(block)
                index += 1
                continue

            if stripped.startswith(">"):
                flush()
                self._quote(stripped.lstrip("> ").strip())
                index += 1
                continue

            if stripped in {"---", "***", "___"}:
                flush()
                paragraph = self.doc.add_paragraph()
                paragraph.paragraph_format.space_before = Pt(2)
                paragraph.paragraph_format.space_after = Pt(8)
                border_paragraph(paragraph, bottom=(6, LINE_HEX))
                index += 1
                continue

            bullet = re.match(r"^[-*]\s+(.*)$", stripped)
            if bullet:
                flush()
                self._bullet(bullet.group(1))
                index += 1
                continue

            numbered = re.match(r"^\d+[.)]\s+(.*)$", stripped)
            if numbered:
                flush()
                self._numbered(numbered.group(1))
                index += 1
                continue

            buffer.append(line)
            index += 1

        flush()
        flush_table()

    def save(self, path: pathlib.Path) -> None:
        self.doc.save(path)
        print(f"wrote {path.relative_to(ROOT)} · figures {len(self.figures)} · tables {len(self.tables)}")


def read(name: str) -> str:
    return (SOURCE / name).read_text()


def chapters_from(text: str, keep: set[str]) -> str:
    matches = list(CHAPTER_RE.finditer(text))
    parts = []
    for position, match in enumerate(matches):
        if match.group(1) not in keep:
            continue
        end = matches[position + 1].start() if position + 1 < len(matches) else len(text)
        parts.append(text[match.start():end])
    return "\n\n".join(parts)


def front_matter_for(kind: str) -> str:
    if kind == "user":
        return """
# About this manual

## Who it is for

This is the operator edition for the people who use JaliCare HMIS during a working day: reception, clinicians, nurses, laboratory and radiology staff, pharmacists, cashiers, accountants, stores and procurement officers, HR and payroll officers, and the administrators who configure the system.

## How to find a task

| If you need to… | Go to |
| --- | --- |
| Sign in, change a password, understand why a menu is missing | Chapter 3 |
| Register a patient or find an existing one | Chapter 5 |
| Book an appointment or call the next patient | Chapter 6 |
| Admit, transfer or discharge a patient | Chapter 7 |
| Receive a specimen and release a result | Chapter 8 |
| Record consent and release a radiology report | Chapter 9 |
| Dispense medicines and check stock | Chapter 10 |
| Record an antenatal visit or a delivery | Chapter 11 |
| Book and record a theatre case | Chapter 12 |
| Record a dialysis session | Chapter 13 |
| Raise an invoice, take a payment or issue a refund | Chapter 14 |
| Post a journal, reconcile the bank, read the trial balance | Chapter 15 |
| Produce the monthly or annual statements | Chapter 16 |
| Record a partner's contribution, drawing or allocation | Chapter 17 |
| Run payroll and issue payslips | Chapter 18 |
| Register an asset or run depreciation | Chapter 19 |
| Raise a requisition, receive goods or count stock | Chapter 20 |
| Keep employee records and attendance | Chapter 21 |
| Prepare a claim for SHA or a private insurer | Chapter 22 |
| Produce an operational report | Chapter 23 |
| Change a tariff, a letterhead or a facility setting | Chapter 24 |

## Before you start

You need a user account issued by your facility administrator, the facility you are posting to, and — for financial work — an open accounting period. If the sidebar is missing a module, the cause is usually one of three things: the facility does not have the module enabled (Chapter 24), your role does not carry the permission (Chapter 3), or you are signed in to a different facility.
"""
    if kind == "technical":
        return """
# About this manual

## Scope

This volume documents how JaliCare HMIS is built and operated: the request path, the data model behind the clinical and financial records, the accounting and reporting engines, the security controls, deployment and maintenance, and the verification record.

It is written for engineers, database administrators, system administrators and technical reviewers, and assumes familiarity with Node.js, TypeScript, PostgreSQL and HTTP APIs.

## What is evidenced and what is not

| Area | Evidence held |
| --- | --- |
| Architecture and request path | Source code and a running instance |
| Database schema | 108 migrations; applied and checked with the migration runner |
| Partner capital and financial statements | 12 database tests, 24 independent numerical comparisons, a 20-step browser run |
| Payroll rules | Rulebook versions in source; calculation engine read; no statutory filing performed |
| Integrations | Interface code read; no live provider connectivity was available |
| Deployment | Dockerfile, compose file and migration runner read; no production deployment performed |

Where a section describes an intention rather than an observed behaviour it says so. Where a control is absent, the manual says it is absent — see Chapter 28.
"""
    if kind == "test":
        return """
# About this report

## Purpose

This report records what was tested for this documentation issue, how it was tested, and what the result was. It is written so that a reviewer can reproduce each test and find the evidence file it produced.

## What this report is not

It is not a certificate of quality, a penetration test, a performance test or a compliance attestation. No load testing, vulnerability scanning or statutory filing was performed; those appear as NOT TESTED with the reason, in section 27.10.

## How results are classified

| Result | Meaning |
| --- | --- |
| PASS | The test ran to completion and the observed result matched the expected result. |
| FAIL | The test ran and the observed result did not match. Defects found during this issue were fixed and re-tested where the evidence says so; the PDF export finding is still open. |
| BLOCKED | The test could not run because an external dependency was unavailable (credentials, provider host, printer, production data). The dependency is named. |
| NOT TESTED | The area was out of scope or no environment existed. It is a gap, and it is not reported as working anywhere in this package. |

## Evidence

- `docs/testing/financial-system/artifacts/` — partner capital database suite, independent verification, browser run
- `docs/audits/*-evidence/` — earlier acceptance runs whose screenshots appear in the manuals
- `docs/documentation/assets/screenshots/` — every image used, with provenance in `docs/documentation/SCREENSHOT_PROVENANCE.md`
"""
    return ""


def build_complete() -> None:
    manual = Manual(
        doc_id="JC-DOC-001",
        title="Complete System Documentation",
        subtitle="User manual, technical manual and test evidence in one volume",
        audience="Facility management, clinical and administrative staff, finance, engineering and support",
        description=(
            "A full description of the JaliCare HMIS build in this repository: the clinical "
            "modules, the money, the reports, the controls around them, the evidence that they "
            "work, and the limits that remain."
        ),
        scope_note=(
            "This volume documents the build at commit 0111b55 and the verification runs recorded "
            "in this repository. It is not a brochure: capabilities that do not exist are named as "
            "absent, and figures from the synthetic facility are labelled synthetic."
        ),
    )
    manual._cover()
    manual._front_matter()
    manual._header_footer()
    front = read("01-front-and-ch1.md")
    # the front matter of the source duplicates the generated document-control pages,
    # so the volume proper starts at Chapter 1
    manual.body(front[front.index("# Chapter 1 —"):])
    for name in ("02-ch2-4.md", "03-ch5-7.md", "04-ch8-12.md",
                 "05-ch13-17.md", "06-ch18-22.md", "07-ch23-26.md", "08-ch27-29.md",
                 "09-appendix-evidence.md"):
        manual.body(read(name))
    manual.save(OUT / "JALICARE_COMPLETE_SYSTEM_DOCUMENTATION.docx")


def build_user_manual() -> None:
    manual = Manual(
        doc_id="JC-UM-001",
        title="User Manual",
        subtitle="Working guide for facility staff — operator edition",
        audience="Reception, clinical, nursing, laboratory, radiology, pharmacy, cashier, accounting, stores, HR and payroll staff",
        description=(
            "How to carry out each task in JaliCare HMIS, screen by screen, with the controls "
            "that will refuse the action and what to do about them."
        ),
        scope_note=(
            "Screens and steps were checked against the running application and against the "
            "recorded acceptance runs. Where a screen could not be exercised for this issue, the "
            "chapter says so rather than describing a sequence that was never run. All names and "
            "amounts are synthetic."
        ),
    )
    manual._cover()
    manual._front_matter()
    manual._header_footer()
    manual.body(front_matter_for("user"))
    ch2 = read("02-ch2-4.md")
    manual.body(ch2[ch2.index("# Chapter 3"):])
    manual.body(read("03-ch5-7.md"))
    manual.body(read("04-ch8-12.md"))
    manual.body(read("05-ch13-17.md"))
    manual.body(read("06-ch18-22.md"))
    manual.body(chapters_from(read("07-ch23-26.md"), {"23", "24"}))
    manual.save(OUT / "JALICARE_USER_MANUAL.docx")


def build_technical_manual() -> None:
    manual = Manual(
        doc_id="JC-TM-001",
        title="Technical Manual",
        subtitle="Architecture, data, accounting engines, security, deployment and verification",
        audience="Engineers, database administrators, system administrators and technical reviewers",
        description=(
            "How the system is put together and how to operate it: the request path and its "
            "controls, the clinical and financial data model, the accounting and reporting "
            "engines, the security posture with its explicit gaps, and the deployment procedure."
        ),
        scope_note=(
            "This manual describes the build at commit 0111b55. Performance figures, penetration "
            "test results and live integration behaviour are absent because none were measured or "
            "exercised; the chapters say so where it matters."
        ),
    )
    manual._cover()
    manual._front_matter()
    manual._header_footer()
    manual.body(front_matter_for("technical"))
    manual.body(chapters_from(read("02-ch2-4.md"), {"2"}))
    manual.body(chapters_from(read("05-ch13-17.md"), {"15", "16", "17"}))
    manual.body(chapters_from(read("07-ch23-26.md"), {"23", "25", "26"}))
    manual.body(read("08-ch27-29.md"))
    manual.body(read("09-appendix-evidence.md"))
    manual.save(OUT / "JALICARE_TECHNICAL_MANUAL.docx")


def build_test_report() -> None:
    manual = Manual(
        doc_id="JC-TVR-001",
        title="Test and Verification Report",
        subtitle="What was executed, what passed, what was blocked and what was not tested",
        audience="Reviewers, facility management, engineering and audit",
        description=(
            "The verification record for this issue: static checks, the full automated suite, "
            "database and domain tests, independent numerical verification, the browser run, "
            "report and export checks, permission tests, the completion register and the evidence "
            "appendix."
        ),
        scope_note=(
            "Tests are reported with the result they actually produced. Blocked and untested areas "
            "are listed with the dependency that prevented them, and the six genuine failures plus "
            "the twelve untriaged ones are named."
        ),
    )
    manual._cover()
    manual._front_matter()
    manual._header_footer()
    manual.body(front_matter_for("test"))
    manual.body(read("08-ch27-29.md"))
    manual.body(read("09-appendix-evidence.md"))
    manual.save(OUT / "JALICARE_TEST_AND_VERIFICATION_REPORT.docx")


def build_markdown_master() -> None:
    names = ["01-front-and-ch1.md", "02-ch2-4.md", "03-ch5-7.md", "04-ch8-12.md",
             "05-ch13-17.md", "06-ch18-22.md", "07-ch23-26.md", "08-ch27-29.md",
             "09-appendix-evidence.md"]
    body = "\n\n".join(read(name) for name in names)
    body = body.replace("](docs/documentation/assets/", "](documentation/assets/")
    toc = []
    for line in body.splitlines():
        if line.startswith("# Chapter") or line.startswith("# Appendix"):
            toc.append(f"- {line[2:].strip()}")
        elif re.match(r"^## \d+\.\d+", line):
            toc.append(f"  - {line[3:].strip()}")
    header = f"""# JaliCare HMIS — Complete System Documentation

**AfyaHub Kenya · Health Information Management System**

| Field | Value |
| --- | --- |
| Document identifier | JC-DOC-001 |
| Version | 1.0 |
| Date | 19 November 2026 |
| Base commit | `0111b5502e1a8d8a21faf53845360122275727df` |
| Branch | `arena/e088f11d-afyahub-hmis-kenya` |
| Classification | Internal — facility operations and technical support |

> This Markdown file is the readable master of the Word volume of the same name. It is assembled
> from the chapter sources in `docs/documentation/source/`. Screenshots are browser captures of the
> running application recorded as acceptance evidence; diagrams are explanatory drawings. Test
> results are those recorded in the Test and Verification Report for this issue.

## Contents

{chr(10).join(toc)}

---

"""
    path = OUT / "JALICARE_COMPLETE_SYSTEM_DOCUMENTATION.md"
    path.write_text(header + body.strip() + "\n")
    print(f"wrote {path.relative_to(ROOT)} · {len(path.read_text().splitlines())} lines")


if __name__ == "__main__":
    build_complete()
    build_user_manual()
    build_technical_manual()
    build_test_report()
    build_markdown_master()

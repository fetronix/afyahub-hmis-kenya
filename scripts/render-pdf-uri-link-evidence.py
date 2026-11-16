"""Render the exact supplied Syrona letterhead and its derived static preview.

This is an independent visual-evidence helper, not part of the application PDF
pipeline. It uses a pinned PyMuPDF in an isolated test dependency directory and
never rewrites either input PDF. It proves that the ephemeral derived preview
preserves visible text/graphics while removing the clickable URI action.
"""

import hashlib
import json
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/audits/pdf-uri-link-evidence"
ORIGINAL = ROOT / "src/tests/fixtures/letterhead-sample-a4.pdf"
DERIVED = OUT / "syrona-derived-static-preview.pdf"
ORIGINAL_HASH = "7650930b5229cd57f58bda9788162b2f56967ba9a72e0aa1cdfa0256adb00ce0"
EXPECTED_URI = "http://www.syronamedicalcenter.co.ke/"
VISIBLE_TEXT = (
    "+ 254 727 335 433",
    "www.syronamedicalcenter.co.ke",
    "info@syronamed.com",
    "Hopewell Place, Nyeri",
    "WHERE HEALING FLOWS NATURALLY",
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).digest().hex()


def render(document: pymupdf.Document, filename: str):
    assert len(document) == 1, "Expected a one-page Syrona letterhead"
    page = document[0]
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False)
    target = OUT / filename
    pixmap.save(target)
    return {
        "png": target.name,
        "pageCount": len(document),
        "links": [
            {"kind": link["kind"], "uri": link.get("uri")} for link in page.get_links()
        ],
        "text": page.get_text(),
        "samplesSha256": hashlib.sha256(pixmap.samples).digest().hex(),
        "width": pixmap.width,
        "height": pixmap.height,
    }


def main() -> None:
    assert pymupdf.VersionBind.startswith("1.26.6"), pymupdf.VersionBind
    assert sha256(ORIGINAL) == ORIGINAL_HASH, "Supplied letterhead hash changed"
    assert DERIVED.is_file(), "Derived static preview was not saved by built-browser acceptance"
    assert sha256(DERIVED) != ORIGINAL_HASH, "Derived preview must not be the original"
    OUT.mkdir(parents=True, exist_ok=True)

    original_document = pymupdf.open(ORIGINAL)
    derived_document = pymupdf.open(DERIVED)
    original = render(original_document, "syrona-original.png")
    derived = render(derived_document, "syrona-derived-static-preview.png")

    assert len(original["links"]) == 1, original["links"]
    assert original["links"][0]["uri"] == EXPECTED_URI, original["links"]
    assert derived["links"] == [], derived["links"]
    assert derived["text"] == original["text"], "Visible text changed in derived preview"
    assert derived["samplesSha256"] == original["samplesSha256"], "Rendered artwork changed"
    for expected in VISIBLE_TEXT:
        assert expected in original["text"] and expected in derived["text"], expected
    assert "Derived static preview" in derived_document.metadata["title"], derived_document.metadata
    assert "not the original" in derived_document.metadata["title"], derived_document.metadata

    result = {
        "syntheticOnly": True,
        "productionAccess": False,
        "pymupdfVersion": pymupdf.VersionBind,
        "original": {
            "path": str(ORIGINAL.relative_to(ROOT)),
            "sha256": ORIGINAL_HASH,
            **original,
        },
        "derivedStaticPreview": {
            "path": str(DERIVED.relative_to(ROOT)),
            "sha256": sha256(DERIVED),
            **derived,
        },
        "visibleTextIdentical": True,
        "renderedPixelsIdentical": True,
        "uriLinkRemovedFromDerivedPreview": True,
    }
    (OUT / "rendering.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print("Rendered original and derived static preview; visible text and pixels are identical")
    print("Original URI link:", original["links"][0]["uri"])
    print("Derived links:", derived["links"])


if __name__ == "__main__":
    main()

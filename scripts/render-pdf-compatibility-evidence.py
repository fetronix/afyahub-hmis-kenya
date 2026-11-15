"""Optional, synthetic-only visual evidence. Requires PyMuPDF==1.26.6.

This is a test tool, not application normalization. It rasterizes only the four
known static synthetic originals retrieved by pdf-compatibility-acceptance.ts.
It never replaces their bytes, runs PDF actions, or renders rejected samples.
Usage: PYTHONPATH=.tmp-tools/pdf-render python3 scripts/render-pdf-compatibility-evidence.py
"""
import hashlib
import json
import os
from pathlib import Path

import pymupdf

root = Path(os.environ.get("PDF_COMPATIBILITY_EVIDENCE_DIR", "docs/audits/pdf-compatibility-evidence"))
results = json.loads((root / "results.json").read_text())
assert results["syntheticOnly"] is True and results["productionAccess"] is False
assert pymupdf.VersionBind == "1.26.6", "Use the pinned isolated test renderer"
rendered = []
for name in ("scanned-letterhead", "scanned-signature", "type3-glyph-A", "static-annotations"):
    original = (root / (name + ".pdf")).read_bytes()
    sha256 = hashlib.sha256(original).hexdigest()
    assert sha256 == results["hashes"][name], "Retrieved original hash mismatch"
    with pymupdf.open(stream=original, filetype="pdf") as pdf:
        assert len(pdf) == 1
        page = pdf[0]
        assert abs(page.rect.width - 595.28) < 0.02
        assert abs(page.rect.height - 841.89) < 0.02
        image = page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False, annots=True)
        # Nonblank content, independent of text extraction (scans are image-only).
        assert sum(v < 220 for v in image.samples) > 1000
        image.save(str(root / ("rendered-" + name + ".png")))
        rendered.append({"name": name, "sha256": sha256, "pages": 1,
                         "widthPt": page.rect.width, "heightPt": page.rect.height,
                         "renderedWidth": image.width, "renderedHeight": image.height,
                         "extractedText": page.get_text().strip()})
    assert (root / (name + ".pdf")).read_bytes() == original
(root / "rendering.json").write_text(json.dumps({"syntheticOnly": True,
    "renderer": "PyMuPDF 1.26.6 (test only, no application normalization)",
    "rendered": rendered}, indent=2) + "\n")
print(f"Rendered {len(rendered)} unchanged retrieved synthetic originals")

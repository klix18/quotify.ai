"""
Post-process Chromium-generated PDFs to compress streams and linearize
for faster loading, WITHOUT re-rendering text or touching font data.

Previously used Ghostscript (gs -sDEVICE=pdfwrite), which re-distills
the entire PDF and destroys glyph positioning / kerning — producing
broken letter spacing like "Hamps tead" and "s izemoreins urance".

Now uses qpdf, which operates at the PDF object/stream level and never
touches text or font tables, preserving Chromium's original rendering.
Falls back to keeping the original Chromium PDF if qpdf is unavailable.

NOTE: --optimize-images is intentionally NOT used because it re-encodes
images (Flate → DCT) and can alter color space metadata, producing
inconsistent DeviceRGB / ICCBased color spaces across PDFs. All source
images have been standardized to have no embedded ICC profiles so that
Chromium consistently outputs DeviceRGB.
"""

import subprocess
import shutil
from pathlib import Path


def optimize_pdf(input_path: Path) -> None:
    """
    Optimize a PDF in-place via qpdf (lossless structural optimization).

    This compresses object streams, removes redundant objects, and
    linearizes the PDF for faster first-page display — without
    re-encoding fonts or re-positioning text glyphs.
    """
    tmp_output = input_path.with_suffix(".optimized.pdf")

    try:
        result = subprocess.run(
            [
                "qpdf",
                "--compress-streams=y",
                "--object-streams=generate",
                "--linearize",
                "--recompress-flate",
                str(input_path),
                str(tmp_output),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode == 0 and tmp_output.exists():
            # Replace original with optimized version
            shutil.move(str(tmp_output), str(input_path))
        else:
            # If qpdf fails, keep the original Chromium PDF (already good)
            tmp_output.unlink(missing_ok=True)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        # qpdf not available or timed out — keep original Chromium PDF
        tmp_output.unlink(missing_ok=True)

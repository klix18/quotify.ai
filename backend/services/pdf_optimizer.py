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

Two entry points:
  optimize_pdf(path)         — operates in-place on a file (legacy callers).
  optimize_pdf_bytes(data)   — bytes-in / bytes-out (used by the in-memory
                                rendering path so generated PDFs never
                                touch disk).
"""

import subprocess
import shutil
from pathlib import Path


# qpdf flags shared between the file and bytes paths.
_QPDF_FLAGS = [
    "--compress-streams=y",
    "--object-streams=generate",
    "--linearize",
    "--recompress-flate",
]


def optimize_pdf(input_path: Path) -> None:
    """
    Optimize a PDF in-place via qpdf (lossless structural optimization).

    Kept for callers that already have a file on disk (e.g. legacy paths
    or templates that prefer file IO). New code should prefer
    ``optimize_pdf_bytes`` to avoid touching the filesystem.
    """
    tmp_output = input_path.with_suffix(".optimized.pdf")

    try:
        result = subprocess.run(
            ["qpdf", *_QPDF_FLAGS, str(input_path), str(tmp_output)],
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode == 0 and tmp_output.exists():
            shutil.move(str(tmp_output), str(input_path))
        else:
            tmp_output.unlink(missing_ok=True)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        tmp_output.unlink(missing_ok=True)


def optimize_pdf_bytes(pdf_bytes: bytes) -> bytes:
    """
    Optimize a PDF using qpdf via stdin/stdout — no temp files.

    qpdf reads from stdin when ``-`` is the input arg, and writes to
    stdout when ``-`` is the output arg. Returns the optimized bytes,
    or the original bytes if qpdf is unavailable / errors out.
    """
    if not pdf_bytes:
        return pdf_bytes

    try:
        result = subprocess.run(
            ["qpdf", *_QPDF_FLAGS, "-", "-"],
            input=pdf_bytes,
            capture_output=True,
            timeout=30,
        )
        if result.returncode == 0 and result.stdout:
            return result.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass
    return pdf_bytes

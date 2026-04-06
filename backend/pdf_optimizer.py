"""
Post-process Chromium-generated PDFs through Ghostscript to flatten
internal structures (layers, clipping paths, transparency groups)
and re-encode the file for smoother scrolling in PDF viewers.
"""

import subprocess
import shutil
from pathlib import Path


def optimize_pdf(input_path: Path) -> None:
    """
    Re-distill a PDF in-place via Ghostscript.

    This flattens compositing layers and clipping paths that Chromium
    embeds during page.pdf(), which can cause laggy scroll/zoom in
    PDF viewers even when the file size is small.
    """
    tmp_output = input_path.with_suffix(".optimized.pdf")

    try:
        result = subprocess.run(
            [
                "gs",
                "-sDEVICE=pdfwrite",
                "-dCompatibilityLevel=1.5",
                "-dPDFSETTINGS=/printer",
                "-sColorConversionStrategy=RGB",
                "-sProcessColorModel=/DeviceRGB",
                "-dConvertCMYKImagesToRGB=true",
                "-dNOPAUSE",
                "-dBATCH",
                "-dQUIET",
                "-dColorImageResolution=200",
                "-dGrayImageResolution=200",
                "-dMonoImageResolution=200",
                f"-sOutputFile={tmp_output}",
                str(input_path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode == 0 and tmp_output.exists():
            # Replace original with optimized version
            shutil.move(str(tmp_output), str(input_path))
        else:
            # If Ghostscript fails, keep the original Chromium PDF
            tmp_output.unlink(missing_ok=True)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        # Ghostscript not available or timed out — keep original
        tmp_output.unlink(missing_ok=True)

#!/usr/bin/env python3
"""
zip_html_files.py
-----------------
For each .html file in a directory (default: same directory as this script),
create a zip containing:
  - the HTML file (renamed to index.html inside the zip)
  - any locally-referenced images found in src="..." / url('...') attributes
  - README.txt from the same directory (if it exists)

Usage:
    python3 zip_html_files.py                    # zips all .html files here
    python3 zip_html_files.py --dir /path/to/dir # zips all .html files there
    python3 zip_html_files.py --file foo.html    # zip a single file
    python3 zip_html_files.py --skip-existing    # skip if .zip already exists

Output zips are written alongside each HTML file (same directory).
"""

import argparse
import os
import re
import zipfile
from pathlib import Path
from urllib.parse import urlparse


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"}

# Matches:  src="..."  url("...")  url('...')  srcset="..."
_REF_RE = re.compile(
    r"""(?:src|href|url)\s*=?\s*['"]([^'"]+)['"]"""
    r"""|url\(\s*['"]?([^'")]+)['"]?\s*\)""",
    re.IGNORECASE,
)


def find_local_images(html_text: str, html_dir: Path) -> list[tuple[Path, str]]:
    """Return (resolved_path, original_ref) for every local image found in the HTML."""
    found = []
    seen = set()
    for m in _REF_RE.finditer(html_text):
        ref = (m.group(1) or m.group(2) or "").strip()
        if not ref or ref in seen:
            continue
        seen.add(ref)
        # Skip external URLs, data URIs, anchors, mailto, etc.
        parsed = urlparse(ref)
        if parsed.scheme in ("http", "https", "data", "mailto", "tel"):
            continue
        if ref.startswith("#"):
            continue
        # Check extension
        suffix = Path(parsed.path).suffix.lower()
        if suffix not in IMAGE_EXTS:
            continue
        # Resolve relative to the HTML file's directory
        candidate = (html_dir / ref).resolve()
        if candidate.exists():
            found.append((candidate, ref))
    return found


def build_zip(html_path: Path, readme_path: Path | None) -> Path:
    """Create a zip for one HTML file. Returns the zip path."""
    html_dir = html_path.parent
    html_text = html_path.read_text(encoding="utf-8", errors="replace")

    images = find_local_images(html_text, html_dir)

    zip_path = html_path.with_suffix(".zip")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        # Add HTML as index.html
        zf.write(html_path, arcname="index.html")

        # Add images using the original ref as the arcname so paths work after unzip
        for img_path, ref in images:
            zf.write(img_path, arcname=ref)

        # Add README.txt if present
        if readme_path and readme_path.exists():
            zf.write(readme_path, arcname="README.txt")

    return zip_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", default=None,
                        help="Directory containing HTML files (default: script's directory)")
    parser.add_argument("--file", default=None,
                        help="Zip a single HTML file instead of a whole directory")
    parser.add_argument("--skip-existing", action="store_true",
                        help="Skip HTML files whose .zip already exists")
    args = parser.parse_args()

    script_dir = Path(__file__).parent

    if args.file:
        html_files = [Path(args.file).resolve()]
    else:
        target_dir = Path(args.dir).resolve() if args.dir else script_dir
        html_files = sorted(target_dir.glob("*.html"))

    if not html_files:
        print("No HTML files found.")
        return

    # Look for README.txt in the same directory as the first html file
    readme = html_files[0].parent / "README.txt"
    if not readme.exists():
        readme = None
        print("Note: README.txt not found — skipping.")

    skipped = 0
    created = 0
    for html in html_files:
        zip_out = html.with_suffix(".zip")
        if args.skip_existing and zip_out.exists():
            print(f"  skip  {html.name}  (zip exists)")
            skipped += 1
            continue
        try:
            result = build_zip(html, readme)
            size_kb = result.stat().st_size // 1024
            print(f"  ok    {result.name}  ({size_kb} KB)")
            created += 1
        except Exception as exc:
            print(f"  ERROR {html.name}: {exc}")

    print(f"\nDone. {created} zip(s) created, {skipped} skipped.")


if __name__ == "__main__":
    main()

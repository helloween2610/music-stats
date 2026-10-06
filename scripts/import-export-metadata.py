"""Regenerate the preview metadata from the primary Apple Music Library.xml."""
import importlib.util
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("library_sync", root / "sync/library_sync.py")
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)
source = str(Path(sys.argv[1])) if len(sys.argv) > 1 else sync.DEFAULT_FILE
rows, total = sync.read_export(source)
if not rows or not any(r.get("extra") for r in rows):
    raise SystemExit("Use a non-empty Apple Music Library.xml export")
out = Path(__file__).resolve().parents[1] / "src/data/export-metadata.json"
sync.write_json(str(out), sync.metadata_export(rows, source))
print(f"Imported {len(rows)} unique tracks from {total} library entries; playlist-only entries excluded.")

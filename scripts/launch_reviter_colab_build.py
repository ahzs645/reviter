#!/usr/bin/env python3
"""Verify, unpack, and build the staged Reviter source inside a Colab VM."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path


CONTENT = Path("/content")
ARCHIVE = CONTENT / "reviter-source.tar.gz"
MANIFEST = CONTENT / "reviter-source-manifest.json"
SOURCE = CONTENT / "reviter"
OUTPUT = CONTENT / "reviter-output"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    actual = sha256(ARCHIVE)
    expected = manifest["archive"]["sha256"]
    if actual != expected:
        raise SystemExit(f"Source archive checksum mismatch: {actual} != {expected}")

    shutil.rmtree(SOURCE, ignore_errors=True)
    shutil.rmtree(OUTPUT, ignore_errors=True)
    with tarfile.open(ARCHIVE, "r:gz") as bundle:
        for member in bundle.getmembers():
            target = (CONTENT / member.name).resolve()
            if target != CONTENT and CONTENT not in target.parents:
                raise SystemExit(f"Unsafe archive member: {member.name}")
        bundle.extractall(CONTENT)

    model = SOURCE / "public/autodesk-reference.glb"
    if sha256(model) != manifest["autodeskModel"]["sha256"]:
        raise SystemExit("Autodesk model checksum mismatch after extraction")

    print(f"Verified {ARCHIVE} ({ARCHIVE.stat().st_size:,} bytes)", flush=True)
    print(f"Verified {model} ({model.stat().st_size:,} bytes)", flush=True)
    subprocess.run(
        [
            sys.executable,
            str(SOURCE / "scripts/run_reviter_colab_build.py"),
            "--source",
            str(SOURCE),
            "--output",
            str(OUTPUT),
        ],
        check=True,
    )
    shutil.make_archive(
        str(CONTENT / "reviter-output"),
        "gztar",
        root_dir=CONTENT,
        base_dir=OUTPUT.name,
    )
    print(f"WROTE {CONTENT / 'reviter-output.tar.gz'}", flush=True)


if __name__ == "__main__":
    main()

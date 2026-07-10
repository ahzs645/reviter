#!/usr/bin/env python3
"""Package the current Reviter workspace and stage its Colab runner in Google Drive."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tarfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DRIVE_PROJECT = (
    Path.home()
    / "Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive"
    / "Reviter"
)
DRIVE_BUILD = DRIVE_PROJECT / "reviter-build"
DRIVE_ASSETS = DRIVE_PROJECT / "assets"
DRIVE_OUTPUTS = DRIVE_PROJECT / "reviter-outputs"
NOTEBOOK = ROOT / "notebooks/reviter_pages_build_colab.ipynb"
TEMP = ROOT / "tmp/jupyter-notebook"
ARCHIVE = TEMP / "reviter-source.tar.gz"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_files() -> list[Path]:
    output = subprocess.check_output(
        ["git", "ls-files", "-co", "--exclude-standard", "-z"],
        cwd=ROOT,
    )
    paths = []
    for item in output.split(b"\0"):
        if not item:
            continue
        relative = Path(item.decode())
        path = ROOT / relative
        if (
            path.is_file()
            and not relative.parts[0].startswith("dist")
            and "__pycache__" not in relative.parts
            and path.suffix not in {".pyc", ".pyo"}
        ):
            paths.append(relative)
    return sorted(set(paths))


def make_cell(kind: str, source: str) -> dict:
    cell = {"cell_type": kind, "metadata": {}, "source": source.splitlines(keepends=True)}
    if kind == "code":
        cell.update({"execution_count": None, "outputs": []})
    return cell


def update_notebook() -> None:
    notebook = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    notebook["metadata"].update(
        {
            "colab": {"provenance": []},
            "kernelspec": {"display_name": "Python 3", "name": "python3"},
            "language_info": {"name": "python"},
        }
    )
    cells = [
        make_cell(
            "markdown",
            """# Build Reviter on Google Colab

This notebook mirrors the Drive-backed CBCTer workflow. It mounts the authenticated
Google Drive, verifies the staged `MyDrive/Reviter` bundle, extracts the active workspace to
fast `/content` storage, runs all Pages checks, and persists the build and logs back
to Drive.

Prerequisites: access to the Drive account containing `MyDrive/Reviter`.

Outline:
1. Mount Drive and locate the staged bundle.
2. Verify its checksum and unpack it under `/content`.
3. Install dependencies and run the production validation build.
4. Inspect the persisted output summary.
""",
        ),
        make_cell("markdown", "## 1. Mount the persistent Drive workspace\n"),
        make_cell(
            "code",
            """from google.colab import drive
drive.mount('/content/drive')
""",
        ),
        make_cell(
            "code",
            """from pathlib import Path

PROJECT = Path('/content/drive/MyDrive/Reviter')
BUILD = PROJECT / 'reviter-build'
ASSETS = PROJECT / 'assets'
OUTPUTS = PROJECT / 'reviter-outputs'
ARCHIVE = BUILD / 'reviter-source.tar.gz'
MANIFEST = BUILD / 'reviter-source-manifest.json'

assert ARCHIVE.exists(), f'Missing source bundle: {ARCHIVE}'
assert MANIFEST.exists(), f'Missing manifest: {MANIFEST}'
assert (ASSETS / 'autodesk-reference.glb').exists(), f'Missing model: {ASSETS}'
OUTPUTS.mkdir(parents=True, exist_ok=True)
print('project:', PROJECT)
print('archive:', ARCHIVE, ARCHIVE.stat().st_size, 'bytes')
""",
        ),
        make_cell("markdown", "## 2. Verify and unpack into `/content`\n"),
        make_cell(
            "code",
            """import hashlib, json, shutil, tarfile

manifest = json.loads(MANIFEST.read_text())
digest = hashlib.sha256(ARCHIVE.read_bytes()).hexdigest()
assert digest == manifest['archive']['sha256'], (digest, manifest['archive']['sha256'])

workspace = Path('/content/reviter')
shutil.rmtree(workspace, ignore_errors=True)
with tarfile.open(ARCHIVE, 'r:gz') as bundle:
    destination = Path('/content').resolve()
    for member in bundle.getmembers():
        target = (destination / member.name).resolve()
        assert target == destination or destination in target.parents, member.name
    bundle.extractall(destination)

assert (workspace / 'package-lock.json').exists()
model = workspace / 'public/autodesk-reference.glb'
assert hashlib.sha256(model.read_bytes()).hexdigest() == manifest['autodeskModel']['sha256']
print('workspace:', workspace)
print('model:', model, model.stat().st_size, 'bytes')
""",
        ),
        make_cell("markdown", "## 3. Run the remote production build\n"),
        make_cell(
            "code",
            """import time

run_id = time.strftime('%Y%m%d-%H%M%S')
run_output = OUTPUTS / run_id
run_output.mkdir(parents=True, exist_ok=True)
print('persistent output:', run_output)

!python /content/reviter/scripts/run_reviter_colab_build.py --source /content/reviter --output "{run_output}"
""",
        ),
        make_cell("markdown", "## 4. Inspect the result saved to Drive\n"),
        make_cell(
            "code",
            """summary = json.loads((run_output / 'reviter-colab-build-summary.json').read_text())
print(json.dumps(summary, indent=2))
assert summary['ok'], summary.get('error')
print('Pages artifact:', summary['artifact']['path'])
""",
        ),
        make_cell(
            "markdown",
            """## Optional rerun and common pitfall

To rebuild after staging a newer source bundle, rerun from **Verify and unpack**.
Do not run `npm ci` or Vite directly inside the mounted Drive directory: many small
`node_modules` writes are substantially slower there. The notebook intentionally keeps
large persistent inputs and outputs in Drive while compiling under `/content`.

Exercise: change `run_id` to a descriptive label for a comparison build. Keep each run
in a separate output directory so the prior artifact and logs remain auditable.
""",
        ),
        make_cell(
            "code",
            """# Answer scaffold for a named comparison run:
# run_id = 'camera-parity-comparison'
# run_output = OUTPUTS / run_id
""",
        ),
    ]
    notebook["cells"] = cells
    NOTEBOOK.write_text(json.dumps(notebook, indent=1), encoding="utf-8")


def main() -> None:
    if not NOTEBOOK.exists():
        raise SystemExit(f"Missing scaffolded notebook: {NOTEBOOK}")
    update_notebook()
    files = source_files()
    TEMP.mkdir(parents=True, exist_ok=True)
    with tarfile.open(ARCHIVE, "w:gz") as bundle:
        for relative in files:
            bundle.add(ROOT / relative, arcname=Path("reviter") / relative)

    model = ROOT / "public/autodesk-reference.glb"
    loader = ROOT / "public/autodesk-gltf-loader.js"
    manifest = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sourceRoot": str(ROOT),
        "fileCount": len(files),
        "files": [str(path) for path in files],
        "archive": {
            "name": ARCHIVE.name,
            "bytes": ARCHIVE.stat().st_size,
            "sha256": sha256(ARCHIVE),
        },
        "autodeskModel": {
            "path": "public/autodesk-reference.glb",
            "bytes": model.stat().st_size,
            "sha256": sha256(model),
        },
        "autodeskLoader": {
            "path": "public/autodesk-gltf-loader.js",
            "bytes": loader.stat().st_size,
            "sha256": sha256(loader),
        },
    }
    manifest_path = TEMP / "reviter-source-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    DRIVE_BUILD.mkdir(parents=True, exist_ok=True)
    DRIVE_ASSETS.mkdir(parents=True, exist_ok=True)
    DRIVE_OUTPUTS.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ARCHIVE, DRIVE_BUILD / ARCHIVE.name)
    shutil.copy2(manifest_path, DRIVE_BUILD / manifest_path.name)
    shutil.copy2(NOTEBOOK, DRIVE_PROJECT / NOTEBOOK.name)
    shutil.copy2(NOTEBOOK, DRIVE_BUILD / NOTEBOOK.name)
    shutil.copy2(model, DRIVE_ASSETS / model.name)
    shutil.copy2(loader, DRIVE_ASSETS / loader.name)

    print(json.dumps({
        "driveProject": str(DRIVE_PROJECT),
        "archive": str(DRIVE_BUILD / ARCHIVE.name),
        "notebook": str(DRIVE_PROJECT / NOTEBOOK.name),
        "assets": str(DRIVE_ASSETS),
        "outputs": str(DRIVE_OUTPUTS),
        "manifest": manifest,
    }, indent=2))


if __name__ == "__main__":
    main()

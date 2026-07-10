#!/usr/bin/env python3
"""Run the Reviter Pages validation/build inside an unpacked Colab workspace."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import time
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_step(name: str, command: list[str], cwd: Path, env: dict[str, str], log) -> dict:
    started = time.time()
    heading = f"\n=== {name}: {' '.join(command)} ===\n"
    print(heading, end="", flush=True)
    log.write(heading)
    log.flush()
    process = subprocess.Popen(
        command,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert process.stdout is not None
    for line in process.stdout:
        print(line, end="", flush=True)
        log.write(line)
    return_code = process.wait()
    log.flush()
    result = {
        "name": name,
        "command": command,
        "returnCode": return_code,
        "seconds": round(time.time() - started, 2),
    }
    if return_code:
        raise subprocess.CalledProcessError(return_code, command)
    return result


def archive_pages(source: Path, destination: Path) -> None:
    with tarfile.open(destination, "w:gz") as archive:
        archive.add(source / "dist-pages", arcname="dist-pages")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("/content/reviter"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    source = args.source.resolve()
    output = args.output
    output.mkdir(parents=True, exist_ok=True)
    log_path = output / "reviter-colab-build.log"
    summary_path = output / "reviter-colab-build-summary.json"
    artifact_path = output / "dist-pages.tar.gz"
    env = os.environ.copy()
    env.update(
        {
            "CI": "1",
            "NODE_OPTIONS": "--max-old-space-size=8192",
            "PAGES_BASE_PATH": "/reviter/",
        }
    )

    summary: dict = {
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": str(source),
        "output": str(output),
        "steps": [],
        "ok": False,
    }
    failure: Exception | None = None
    with log_path.open("w", encoding="utf-8") as log:
        try:
            commands = [
                ("environment", ["bash", "-lc", "node --version && npm --version && free -h"]),
                ("dependencies", ["npm", "ci", "--no-audit", "--no-fund"]),
                ("types", ["npx", "tsc", "--noEmit"]),
                ("lint", ["npm", "run", "lint"]),
                ("pages", ["npm", "run", "test:pages"]),
            ]
            for name, command in commands:
                summary["steps"].append(run_step(name, command, source, env, log))
            archive_pages(source, artifact_path)
            summary["artifact"] = {
                "path": str(artifact_path),
                "bytes": artifact_path.stat().st_size,
                "sha256": sha256(artifact_path),
            }
            summary["ok"] = True
        except Exception as exc:  # noqa: BLE001 - persist diagnostics before failing
            failure = exc
            summary["error"] = f"{type(exc).__name__}: {exc}"
        finally:
            summary["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(json.dumps(summary, indent=2))
    if failure is not None:
        raise failure


if __name__ == "__main__":
    main()

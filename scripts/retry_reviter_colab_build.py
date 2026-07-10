#!/usr/bin/env python3
"""Rerun the Reviter build in an already prepared Colab workspace."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


SOURCE = Path("/content/reviter")
OUTPUT = Path("/content/reviter-output")


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

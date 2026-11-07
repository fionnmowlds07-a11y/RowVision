"""Identify the analysis code, so that a result can say what measured it."""

import functools
import hashlib
from pathlib import Path

import rowvision

RESULT_VERSION = 3
"""Raise this when the saved JSON changes shape."""


@functools.cache
def code_version() -> str:
    """Hash the analysis code and targets.

    Read once, as a running service keeps the code it started with. Hashing the files again later
    would stamp its results with the version of whatever has since been checked out.
    """
    digest = hashlib.sha256(str(RESULT_VERSION).encode())
    package = Path(rowvision.__file__).parent
    targets = package.parent / "reference"
    for path in [*sorted(package.glob("*.py")), *sorted(targets.glob("*.yaml"))]:
        digest.update(path.read_bytes())
    return digest.hexdigest()

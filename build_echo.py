#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Build one executable zipapp without installing packages or running hooks."""
import argparse
from pathlib import Path
import shutil
import tempfile
import zipapp


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ncp-echo-build-") as temporary:
        staging = Path(temporary)
        shutil.copyfile(root / "python" / "ncp.py", staging / "ncp.py")
        shutil.copyfile(root / "examples" / "echo.py", staging / "__main__.py")
        shutil.copyfile(root / "LICENSE", staging / "LICENSE")
        zipapp.create_archive(staging, args.output, interpreter="/usr/bin/env python3")
    args.output.chmod(0o755)


if __name__ == "__main__":
    main()

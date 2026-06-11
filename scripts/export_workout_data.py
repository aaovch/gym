"""Copy workout JSON database into the static site folder (delegates to sync_static_data)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sync_static_data import main  # noqa: E402

if __name__ == "__main__":
    main()

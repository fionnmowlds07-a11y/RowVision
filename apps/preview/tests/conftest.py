import sys
from pathlib import Path

# Reuse the vision service's synthetic crews rather than building a second set.
sys.path.append(str(Path(__file__).parents[3] / "services" / "vision" / "tests"))

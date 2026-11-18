"""Test setup shared by every test module.

The uploads vector store goes to a throwaway directory so tests never touch real
users' books. This runs before any test module imports retrieval.
"""

import os
import shutil
import sys
import tempfile
from pathlib import Path

_uploads_dir = tempfile.mkdtemp(prefix="lorelai-test-uploads-")
os.environ["RAG_UPLOADS_DB"] = _uploads_dir
# Never let a test reach a real model by accident
os.environ.pop("OPENROUTER_API_KEY", None)
os.environ.pop("LLM_PROVIDER", None)

# Make backend/ importable when pytest is started from the repo root
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def pytest_sessionfinish(session, exitstatus):
    # Chroma may still hold the files open on Windows; leftovers in %TEMP% are harmless
    shutil.rmtree(_uploads_dir, ignore_errors=True)

"""
Fixtures for Chronicle v3.1 migration property tests.
"""
import os
import pytest

CHRONICLE_DB_PATH = r"c:\Users\bhillrog\Desktop\repository\Chronicle Data\chronicle.db"


@pytest.fixture
def db_path():
    """Returns the path to the live Chronicle database."""
    assert os.path.exists(CHRONICLE_DB_PATH), (
        f"Chronicle database not found at {CHRONICLE_DB_PATH}"
    )
    return CHRONICLE_DB_PATH

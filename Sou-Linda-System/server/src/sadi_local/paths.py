"""Writable user data lives outside installation/build directories."""
import os
import sys
from pathlib import Path

def data_directory() -> Path:
    override = os.environ.get("SADI_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "SouLindaSystem"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "SouLindaSystem"
    return Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))) / "SouLindaSystem"

def database_path() -> Path:
    return data_directory() / "sou-linda.sqlite3"

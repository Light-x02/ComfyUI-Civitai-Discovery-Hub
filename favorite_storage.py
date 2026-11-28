"""Choose and relocate the single-user favorites database on the ComfyUI host."""
import ipaddress
import os
import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from folder_paths import get_system_user_directory

from . import favorites

if os.name == "nt":
    import winreg

DEFAULT_SUBFOLDER = Path("Comfyui Light_x02") / "Civitai Discovery Hub"


def default_folder():
    documents = Path.home() / "Documents"
    if os.name == "nt":
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders") as key:
                documents = Path(os.path.expandvars(winreg.QueryValueEx(key, "Personal")[0]))
        except FileNotFoundError:
            pass
    elif os.name == "posix":
        config = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "user-dirs.dirs"
        try:
            lines = config.read_text(encoding="utf-8").splitlines()
        except FileNotFoundError:
            lines = []
        for line in lines:
            key, _, value = line.strip().partition("=")
            if key == "XDG_DOCUMENTS_DIR":
                candidate = Path(os.path.expandvars(value.strip('"')))
                if candidate.is_absolute():
                    documents = candidate
                break
    return documents / DEFAULT_SUBFOLDER


class FolderError(ValueError):
    pass


def local_request(request):
    def loopback(host):
        if host == "localhost":
            return True
        try:
            address = ipaddress.ip_address(host)
            return address.is_loopback or bool(getattr(address, "ipv4_mapped", None) and address.ipv4_mapped.is_loopback)
        except ValueError:
            return False

    origin = request.headers.get("Origin")
    return (loopback(request.remote) and loopback(urlsplit("//" + request.host).hostname)
            and (not origin or origin == request.scheme + "://" + request.host))


def local_folder(value):
    if not isinstance(value, str) or not value.strip() or "\x00" in value:
        raise FolderError("Enter a full folder path.")
    path = Path(value.strip())
    if not path.is_absolute():
        raise FolderError("Enter a full folder path.")
    if os.name == "nt" and (path.drive.startswith("\\") or
            any(Path(part).is_reserved() or any(c in '<>:"|?*' for c in part) for part in path.parts[1:])):
        raise FolderError("Choose an absolute path on a local drive.")
    path = path.resolve()
    if os.name == "nt" and path.drive.startswith("\\"):
        raise FolderError("Choose a folder on a local drive.")
    return path


def list_folders(value):
    folder = local_folder(value)
    while not folder.exists() and folder != folder.parent:
        folder = folder.parent
    with os.scandir(folder) as entries:
        paths = sorted((Path(p.path) for p in entries if not p.name.startswith(".") and p.is_dir(follow_symlinks=False)),
                       key=lambda p: p.name.casefold())
    drives = [p for p in os.listdrives() if not p.startswith("\\")] if hasattr(os, "listdrives") else []
    return {"folder": str(folder), "parent": str(folder.parent), "drives": drives,
            "children": [{"name": p.name, "path": str(p)} for p in paths]}


@contextmanager
def settings():
    directory = Path(get_system_user_directory("civitai_discovery_hub"))
    directory.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(directory / "storage.sqlite3", timeout=30)) as db, db:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA trusted_schema=OFF")
        db.execute("BEGIN IMMEDIATE")
        db.execute("CREATE TABLE IF NOT EXISTS location (id INTEGER PRIMARY KEY CHECK(id=1), folder TEXT NOT NULL)")
        yield db


def saved_folder(db):
    row = db.execute("SELECT folder FROM location WHERE id=1").fetchone()
    return Path(row[0]) if row else None


def _occupied(db, schema):
    return db.execute(f"""SELECT EXISTS (SELECT 1 FROM {schema}.favorite)
        OR EXISTS (SELECT 1 FROM {schema}.favorite_collection)
        OR EXISTS (SELECT 1 FROM {schema}.saved_search)""").fetchone()[0]


def _prepare(path, legacy, *, empty=False):
    # A custom folder may contain a different application's database with the same name.
    if path.is_symlink():
        raise FolderError("Choose a folder where favorites.sqlite3 is a regular file.")
    with closing(sqlite3.connect(path)) as db, db:
        db.execute("PRAGMA trusted_schema=OFF")
        objects = set(db.execute("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"))
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if objects or version:
            columns = {"favorite": ["id", "data", "author", "level", "video", "prompt", "created", "reactions", "comments", "tag_ids"]}
            indexes = {("index", "favorite_created")} if version >= 2 else set()
            if version >= 3:
                columns.update(favorite_collection=["key", "name"], collection_item=["collection_key", "favorite_id"],
                               saved_search=["key", "name", "settings"])
                indexes.add(("index", "collection_item_favorite"))
            if version == 4:
                columns["favorite_collection"].append("cover_id")
            if (version not in (1, 2, 3, 4) or objects != indexes | {("table", name) for name in columns}
                    or any([row[1] for row in db.execute(f"PRAGMA table_info({table})")] != names
                           for table, names in columns.items())):
                raise FolderError("This folder contains a different favorites.sqlite3. Choose another folder.")
            if empty and (_occupied(db, "main") if version >= 3 else db.execute("SELECT 1 FROM favorite LIMIT 1").fetchone()):
                raise FolderError("This folder already contains favorites, collections or saved searches. Choose an empty folder.")
        # SQLite's cross-file commit uses rollback journals during relocation.
        if db.execute("PRAGMA journal_mode=DELETE").fetchone()[0] != "delete":
            raise FolderError("Close other applications using this database and try again.")
        favorites._initialize_favorites(db, legacy)


def _relocate(db, profile, previous, folder):
    source = previous / "favorites.sqlite3" if previous else Path(profile)
    target = folder / "favorites.sqlite3"
    if previous and not source.is_file():
        raise FolderError("The current favorites database is unavailable. Reconnect its drive and try again.")
    if previous == folder:
        return
    if not previous:
        source.parent.mkdir(parents=True, exist_ok=True)
        if not source.exists() and favorites.LEGACY_FILE.is_file():
            _prepare(source, favorites.LEGACY_FILE)
    folder.mkdir(parents=True, exist_ok=True)
    same = source.exists() and target.exists() and source.samefile(target)
    _prepare(target, None, empty=bool(previous) and not same)
    if source.exists() and not same:
        _prepare(source, favorites.LEGACY_FILE if not previous else None)
        db.execute("ATTACH DATABASE ? AS destination", (str(target),))
        db.execute("ATTACH DATABASE ? AS original", (str(source),))
        if previous and _occupied(db, "destination"):
            raise FolderError("This folder already contains favorites, collections or saved searches. Choose an empty folder.")
        # The setting and both collections commit together, including moves between drives.
        copy_rows = "INSERT INTO destination.favorite SELECT * FROM original.favorite WHERE true ORDER BY rowid"
        db.execute(copy_rows if previous else copy_rows + " ON CONFLICT(id) DO NOTHING")
        for table in ("favorite_collection", "saved_search", "collection_item"):
            db.execute(f"INSERT INTO destination.{table} SELECT * FROM original.{table} WHERE true ON CONFLICT DO NOTHING")
        if previous:
            db.execute("DELETE FROM original.favorite")
            db.execute("DELETE FROM original.favorite_collection")
            db.execute("DELETE FROM original.saved_search")
    db.execute("INSERT OR REPLACE INTO location VALUES (1, ?)", (str(folder),))


def _info(folder):
    default = default_folder()
    active = default if folder is None or folder == default.resolve() else folder
    return {"folder": str(active), "defaultFolder": str(default),
            "defaultLabel": (Path("Documents") / DEFAULT_SUBFOLDER).as_posix()}


def location_info():
    with settings() as db:
        return _info(saved_folder(db))


def change_folder(profile, value):
    folder = local_folder(value)
    default = default_folder()
    # A freshly installed copy can already have a collection in Documents.
    with settings() as db:
        if not saved_folder(db) and folder != default and (default / "favorites.sqlite3").is_file():
            _relocate(db, profile, None, default)
    with settings() as db:
        _relocate(db, profile, saved_folder(db), folder)
    return _info(folder)


@contextmanager
def open_collection(profile, write):
    # Hold the settings lock until the operation commits so another node or process cannot move it mid-write.
    while True:
        with settings() as db:
            folder = saved_folder(db)
            if folder is None:
                _relocate(db, profile, None, default_folder())
                continue
            path = folder / "favorites.sqlite3"
            if not path.is_file():
                raise FolderError("The favorites database is unavailable. Reconnect its drive and try again.")
            with favorites.open_database(path, import_legacy=False, write=write) as collection:
                yield collection
            return

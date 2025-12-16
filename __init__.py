# ----- SECTION: Imports -----
import asyncio
import importlib.util
import inspect
import os
import sys
from typing import Any, Awaitable, Callable, List, Optional

# ----- SECTION: Public Globals -----
WEB_DIRECTORY = "./js"

# ----- SECTION: Module Discovery -----
def _discover_py_files() -> List[str]:
    pkg_dir = os.path.dirname(__file__)
    files: List[str] = []
    for fname in os.listdir(pkg_dir):
        if not fname.endswith(".py"):
            continue
        if fname == "__init__.py":
            continue
        if fname.startswith("_"):
            continue
        files.append(os.path.join(pkg_dir, fname))
    files.sort()
    return files


def _safe_mod_name(i: int, path: str) -> str:
    base = os.path.splitext(os.path.basename(path))[0]
    pkg = os.path.basename(os.path.dirname(__file__))
    pkg = "".join(c if (c.isalnum() or c == "_") else "_" for c in pkg)
    base = "".join(c if (c.isalnum() or c == "_") else "_" for c in base)
    return f"_v3_{pkg}_{base}_{i}"


def _load_modules(py_files: List[str]) -> List[Any]:
    modules: List[Any] = []
    for i, fpath in enumerate(py_files):
        try:
            mod_name = _safe_mod_name(i, fpath)
            spec = importlib.util.spec_from_file_location(mod_name, fpath)
            if spec is None or spec.loader is None:
                continue
            mod = importlib.util.module_from_spec(spec)
            sys.modules[mod_name] = mod
            spec.loader.exec_module(mod)
            modules.append(mod)
        except Exception as e:
            print(f"[custom_nodes] Import failed for {fpath}: {e}")
    return modules


_MODULES = _load_modules(_discover_py_files())
_ENTRYPOINTS: List[Callable[[], Any]] = []
for _m in _MODULES:
    _ep = getattr(_m, "comfy_entrypoint", None)
    if callable(_ep):
        _ENTRYPOINTS.append(_ep)

# ----- SECTION: Await Helper -----
async def _await_if_needed(v: Any) -> Any:
    if asyncio.iscoroutine(v) or isinstance(v, Awaitable):
        return await v
    return v

# ----- SECTION: V3 Entry Point (comfy_entrypoint) -----
async def comfy_entrypoint():
    from comfy_api.latest import ComfyExtension, io as comfy_io

    class _AggregateExtension(ComfyExtension):
        async def get_node_list(self) -> list[type[comfy_io.ComfyNode]]:
            nodes: List[type[comfy_io.ComfyNode]] = []
            for ep in _ENTRYPOINTS:
                ext = await _await_if_needed(ep())
                if ext is None:
                    continue
                get_list = getattr(ext, "get_node_list", None)
                if not callable(get_list):
                    continue
                lst = await _await_if_needed(get_list())
                if isinstance(lst, list):
                    for n in lst:
                        if n not in nodes:
                            nodes.append(n)
            return nodes

    return _AggregateExtension()

# ----- SECTION: Exports -----
__all__ = ["WEB_DIRECTORY", "comfy_entrypoint"]

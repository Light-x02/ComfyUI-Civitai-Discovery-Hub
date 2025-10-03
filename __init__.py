import os
import importlib

WEB_DIRECTORY = "./js"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

SKIP_MODULES = set({
})

def _safe_import(module_name):
    try:
        return importlib.import_module(f"{__name__}.{module_name}")
    except Exception as e:
        print(f"[custom_nodes] Import failed for {module_name}: {e}")
        return None

def _discover_modules():
    pkg_dir = os.path.dirname(__file__)
    mods = []
    for fname in os.listdir(pkg_dir):
        if not fname.endswith(".py"):
            continue
        if fname == "__init__.py":
            continue
        if fname.startswith("_"):
            continue
        mod_name = fname[:-3]
        if mod_name in SKIP_MODULES:
            continue
        mods.append(mod_name)
    mods.sort()
    return mods

for mod_name in _discover_modules():
    mod = _safe_import(mod_name)
    if not mod:
        continue
    NODE_CLASS_MAPPINGS.update(getattr(mod, "NODE_CLASS_MAPPINGS", {}))
    NODE_DISPLAY_NAME_MAPPINGS.update(getattr(mod, "NODE_DISPLAY_NAME_MAPPINGS", {}))

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]


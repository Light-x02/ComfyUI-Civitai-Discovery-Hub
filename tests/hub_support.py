"""Load the installed extension with a route registry, outside a running ComfyUI."""
import importlib
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

from aiohttp import web


def module(name, **attributes):
    result = ModuleType(name)
    result.__dict__.update(attributes)
    return result


package = module("cdh_test_package", __path__=[str(Path(__file__).resolve().parents[1])])
server = SimpleNamespace(routes=web.RouteTableDef(), user_manager=None)
standins = {
    package.__name__: package,
    "server": module("server", PromptServer=SimpleNamespace(instance=server)),
    "comfy": module("comfy", __path__=[]),
    "comfy.cli_args": module("comfy.cli_args", args=SimpleNamespace(multi_user=False)),
    "comfy_api": module("comfy_api", __path__=[]),
    "comfy_api.latest": module("comfy_api.latest", io=SimpleNamespace(ComfyNode=object, Schema=object)),
}
previous = {name: sys.modules.get(name) for name in standins}
sys.modules.update(standins)
try:
    hub = importlib.import_module(package.__name__ + ".Civitai_Discovery_Hub")
    lora = importlib.import_module(package.__name__ + ".ClearLoraName")
finally:
    for name, original in previous.items():
        if original is None:
            del sys.modules[name]
        else:
            sys.modules[name] = original

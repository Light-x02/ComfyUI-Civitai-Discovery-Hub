from comfy_api.latest import ComfyExtension, io

from .Civitai_Discovery_Hub import CivitaiDiscoveryHubNode
from .ClearLoraName import ClearLoraName

WEB_DIRECTORY = "./js"


class CivitaiDiscoveryHubExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [CivitaiDiscoveryHubNode, ClearLoraName]


async def comfy_entrypoint() -> ComfyExtension:
    return CivitaiDiscoveryHubExtension()

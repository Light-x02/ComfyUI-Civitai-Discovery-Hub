# Developed by Light-x02
# https://github.com/Light-x02/ComfyUI-Civitai-Discovery-Hub

# ----- SECTION: Imports -----
import re
from typing_extensions import override
from comfy_api.latest import ComfyExtension, io as comfy_io


# ----- SECTION: Node (V3) -----
class ClearLoraName(comfy_io.ComfyNode):
    # Regex robuste: <lora: ... > (espaces optionnels, contenu libre jusqu'à '>')
    _LORA_TAG_RE = re.compile(r"<\s*lora\s*:[^>]*>", re.IGNORECASE)

    @classmethod
    def define_schema(cls) -> comfy_io.Schema:
        return comfy_io.Schema(
            node_id="ClearLoraName",
            display_name="🧹 Clear LoRA Name",
            category="💡Lightx02/utilities",
            inputs=[
                comfy_io.Boolean.Input(
                    "enabled",
                    default=True,
                    tooltip="Enable/disable the LoRA tag stripping (pass-through when disabled).",
                ),
                comfy_io.String.Input(
                    "positive_prompt",
                    default="",
                    multiline=True,
                    optional=True,
                    force_input=True,
                    tooltip="Positive prompt (optional). Any <lora:...> tags will be removed.",
                ),
                comfy_io.String.Input(
                    "negative_prompt",
                    default="",
                    multiline=True,
                    optional=True,
                    force_input=True,
                    tooltip="Negative prompt (optional). Any <lora:...> tags will be removed.",
                ),
            ],
            outputs=[
                comfy_io.String.Output(display_name="positive_prompt"),
                comfy_io.String.Output(display_name="negative_prompt"),
            ],
        )

    @staticmethod
    def _strip_lora_tags(text: str) -> str:
        if not isinstance(text, str) or not text:
            return ""
        # 1) Supprimer tous les tags <lora:...>
        cleaned = ClearLoraName._LORA_TAG_RE.sub(" ", text)
        # 2) Réduire les espaces multiples
        cleaned = re.sub(r"\s{2,}", " ", cleaned)
        # 3) Nettoyer les espaces avant la ponctuation
        cleaned = re.sub(r"\s+([,.;:!?])", r"\1", cleaned)
        # 4) Trim final
        return cleaned.strip()

    @classmethod
    def is_changed(cls, enabled: bool = True, positive_prompt: str = "", negative_prompt: str = "", **kwargs):
        # Recalcule dès qu'une entrée change
        return (bool(enabled), str(positive_prompt or ""), str(negative_prompt or ""))

    @classmethod
    def execute(cls, enabled: bool = True, positive_prompt: str = "", negative_prompt: str = ""):
        pos_in = str(positive_prompt or "")
        neg_in = str(negative_prompt or "")

        if not enabled:
            return (pos_in, neg_in)

        pos = cls._strip_lora_tags(pos_in)
        neg = cls._strip_lora_tags(neg_in)
        return (pos, neg)


# ----- SECTION: Entry Point (comfy_entrypoint) -----
class ClearLoraNameExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[comfy_io.ComfyNode]]:
        return [ClearLoraName]


async def comfy_entrypoint() -> ComfyExtension:
    return ClearLoraNameExtension()

# Developed by Light-x02
# https://github.com/Light-x02/ComfyUI-Civitai-Discovery-Hub

# ----- SECTION: Imports -----
import re
from comfy_api.latest import io as comfy_io


# ----- SECTION: Node (V3) -----
class ClearLoraName(comfy_io.ComfyNode):
    _TAG = r"<[ \t]*lora[ \t]*:[^<>\r\n]*>"
    _LORA_TAGS = re.compile(rf"{_TAG}(?:[ \t]*(?:,[ \t]*)?{_TAG})*", re.IGNORECASE)

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

    @classmethod
    def _strip_lora_tags(cls, text: str) -> str:
        parts = cls._LORA_TAGS.split(text)
        for i in range(len(parts) - 1):
            before, after = parts[i], parts[i + 1]
            left, right = before.rstrip(" \t"), after.lstrip(" \t")
            line_start = not left or left.endswith(("\r", "\n"))
            line_end = not right or right.startswith(("\r", "\n"))
            if line_start:
                if line_end:
                    parts[i] = left
                parts[i + 1] = right.removeprefix(",").lstrip(" \t")
            elif line_end or right.startswith(","):
                parts[i] = left.removesuffix(",").rstrip(" \t")
                parts[i + 1] = right
            elif right[0] in ".)]}" or left[-1] in "([{":
                parts[i], parts[i + 1] = left, right
            else:
                # Keep existing horizontal spacing on one side of the deleted tags.
                space = before[len(left):] or after[:len(after) - len(right)]
                if not space and left[-1].isalnum() and right[0].isalnum():
                    space = " "
                parts[i], parts[i + 1] = left + space, right
        return "".join(parts)

    @classmethod
    def execute(cls, enabled: bool = True, positive_prompt: str = "", negative_prompt: str = ""):
        pos_in = str(positive_prompt or "")
        neg_in = str(negative_prompt or "")

        if not enabled:
            return (pos_in, neg_in)

        pos = cls._strip_lora_tags(pos_in)
        neg = cls._strip_lora_tags(neg_in)
        return (pos, neg)

import re

class ClearLoraName:
    """
    Nœud utilitaire pour nettoyer les prompts en supprimant les tags LoRA.

    Entrées :
      - enabled (BOOLEAN, requis) : active/désactive le nettoyage
      - positive_prompt (STRING, optionnel)
      - negative_prompt (STRING, optionnel)

    Sorties :
      - positive_prompt (STRING) nettoyé ou inchangé si disabled
      - negative_prompt (STRING) nettoyé ou inchangé si disabled
    """

    # Regex robuste: <lora: ... > (espaces optionnels, contenu libre jusqu'à '>')
    _LORA_TAG_RE = re.compile(r"<\s*lora\s*:[^>]*>", re.IGNORECASE)

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "enabled": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "positive_prompt": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "forceInput": True,   # connecteur d'entrée visible même en optionnel
                    },
                ),
                "negative_prompt": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "forceInput": True,   # connecteur d'entrée visible même en optionnel
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive_prompt", "negative_prompt")
    FUNCTION = "clear"
    CATEGORY = "💡Lightx02/Utils"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Recalcule quand les entrées changent
        return float("NaN")

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

    def clear(self, enabled: bool = True, positive_prompt: str = "", negative_prompt: str = ""):
        if not enabled:
            # Pass-through
            return (positive_prompt or "", negative_prompt or "")
        pos = self._strip_lora_tags(positive_prompt or "")
        neg = self._strip_lora_tags(negative_prompt or "")
        return (pos, neg)


# Enregistrement du nœud
NODE_CLASS_MAPPINGS = {
    "ClearLoraName": ClearLoraName,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ClearLoraName": "🧹 Clear LoRA Name",
}


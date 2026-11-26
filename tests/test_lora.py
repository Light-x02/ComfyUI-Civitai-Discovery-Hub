from unittest import TestCase

from hub_support import lora


class ClearLoraTests(TestCase):
    def test_only_lora_tags_and_their_separators_change(self):
        cases = (
            ("red, <lora:A:1>, blue", "red, blue"),
            ("<lora:A:1>, portrait", "portrait"),
            ("portrait, <lora:A:1>", "portrait"),
            ("a, <LoRa:A:1>, < lora :B:1> , b", "a, b"),
            ("left<lora:A:1><lora:B:1>right", "left right"),
            ("A <lora:A:1> beside <lora:B:1> B", "A beside B"),
            ("(subject <lora:A:1>).", "(subject)."),
            ("  portrait  !\r\n\r\n  <lora:A:1>, dusk  ", "  portrait  !\r\n\r\n  dusk  "),
            ("a\n  <lora:A:1>  \nb", "a\n\nb"),
            ("  <lora:A:1>  ", ""),
            ("  intact :\n\ntwo  spaces  !\n", "  intact :\n\ntwo  spaces  !\n"),
        )
        for original, expected in cases:
            with self.subTest(original=original):
                self.assertEqual(lora.ClearLoraName.execute(positive_prompt=original), (expected, ""))

    def test_bypass_optional_inputs_and_negative_prompt(self):
        prompt = "\ntext, <lora:A:1>  "
        self.assertEqual(lora.ClearLoraName.execute(False, prompt, prompt), (prompt, prompt))
        self.assertEqual(lora.ClearLoraName.execute(), ("", ""))
        self.assertEqual(lora.ClearLoraName.execute(negative_prompt=prompt), ("", "\ntext"))

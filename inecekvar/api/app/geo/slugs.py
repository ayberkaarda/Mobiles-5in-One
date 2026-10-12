import re
import unicodedata


def slugify(value: str) -> str:
    value = value.translate(str.maketrans("ÇĞİÖŞÜçğıöşü", "CGIOSUcgiosu"))
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")[:110] or "hat"

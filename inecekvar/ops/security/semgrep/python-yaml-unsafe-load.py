# Fixture for iv-python-yaml-unsafe-load (semgrep --test).
import yaml


def positives(document: str) -> None:
    # ruleid: iv-python-yaml-unsafe-load
    yaml.load(document)
    # ruleid: iv-python-yaml-unsafe-load
    yaml.load(document, Loader=yaml.Loader)
    # ruleid: iv-python-yaml-unsafe-load
    yaml.unsafe_load(document)
    # ruleid: iv-python-yaml-unsafe-load
    yaml.full_load(document)


def negatives(document: str) -> None:
    # ok: iv-python-yaml-unsafe-load
    yaml.safe_load(document)
    # ok: iv-python-yaml-unsafe-load
    yaml.load(document, Loader=yaml.SafeLoader)
    # ok: iv-python-yaml-unsafe-load
    yaml.load_all(document, Loader=yaml.CSafeLoader)

# Fixture for iv-python-weak-hash (semgrep --test).
import hashlib


def positives(token: bytes) -> None:
    # ruleid: iv-python-weak-hash
    hashlib.md5(token).hexdigest()
    # ruleid: iv-python-weak-hash
    hashlib.sha1(token).hexdigest()
    # ruleid: iv-python-weak-hash
    hashlib.new("md5", token)


def negatives(token: bytes, body: bytes) -> None:
    # ok: iv-python-weak-hash
    hashlib.sha256(token).hexdigest()
    # ok: iv-python-weak-hash
    hashlib.md5(body, usedforsecurity=False).hexdigest()
    # ok: iv-python-weak-hash
    hashlib.new("sha256", token)

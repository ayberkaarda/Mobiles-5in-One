# Fixture for iv-python-secret-compare (semgrep --test).
import hashlib
import hmac


def positives(header: str, expected_secret: str, body: bytes, key: bytes, sent: str) -> bool:
    # ruleid: iv-python-secret-compare
    if header == expected_secret:
        return True
    computed_signature = hmac.new(key, body, hashlib.sha256).hexdigest()
    # ruleid: iv-python-secret-compare
    if computed_signature != sent:
        return False
    # ruleid: iv-python-secret-compare
    return hashlib.sha256(body).hexdigest() == stored_token_digest(sent)


def stored_token_digest(value: str) -> str:
    return value


def sql_negative(select, session_model, digest: str):
    # ok: iv-python-secret-compare
    return select(session_model).where(session_model.token_hash == digest)


def negatives(header: str, expected_secret: str, token_type: str, signature: str | None) -> bool:
    # ok: iv-python-secret-compare
    if hmac.compare_digest(header.encode(), expected_secret.encode()):
        return True
    # ok: iv-python-secret-compare
    if token_type == "refresh":
        return False
    # ok: iv-python-secret-compare
    if signature == None:  # noqa: E711
        return False
    # ok: iv-python-secret-compare
    return len(signature) == 64

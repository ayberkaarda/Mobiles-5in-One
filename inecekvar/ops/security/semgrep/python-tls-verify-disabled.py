# Fixture for iv-python-tls-verify-disabled (semgrep --test).
import ssl

import httpx
import requests


def positives(url: str) -> None:
    # ruleid: iv-python-tls-verify-disabled
    httpx.AsyncClient(base_url=url, verify=False)
    # ruleid: iv-python-tls-verify-disabled
    httpx.get(url, verify=False)
    # ruleid: iv-python-tls-verify-disabled
    requests.post(url, json={}, verify=False)
    session = requests.Session()
    # ruleid: iv-python-tls-verify-disabled
    session.verify = False
    # ruleid: iv-python-tls-verify-disabled
    ssl._create_unverified_context()
    context = ssl.create_default_context()
    # ruleid: iv-python-tls-verify-disabled
    context.verify_mode = ssl.CERT_NONE


def negatives(url: str, bundle: str) -> None:
    # ok: iv-python-tls-verify-disabled
    httpx.AsyncClient(base_url=url, timeout=5.0)
    # ok: iv-python-tls-verify-disabled
    httpx.get(url, verify=bundle)
    # ok: iv-python-tls-verify-disabled
    requests.post(url, json={}, timeout=5)
    # ok: iv-python-tls-verify-disabled
    ssl.create_default_context()

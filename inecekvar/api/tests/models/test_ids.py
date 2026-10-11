import itertools
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.core import ids
from app.core.ids import uuid7, uuid7_timestamp_ms


@pytest.fixture(autouse=True)
def _reset_uuid_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ids, "_timestamp_ms", -1)
    monkeypatch.setattr(ids, "_counter", 0)


def test_version_and_variant() -> None:
    value = uuid7()
    assert value.version == 7
    assert value.variant == uuid.RFC_4122


def test_timestamp_window() -> None:
    before = time.time_ns() // 1_000_000
    value = uuid7()
    after = time.time_ns() // 1_000_000
    assert before <= uuid7_timestamp_ms(value) <= after


def test_consecutive_ids() -> None:
    values = [uuid7().int for _ in range(10_000)]
    assert len(set(values)) == 10_000
    assert all(left < right for left, right in itertools.pairwise(values))


def _thread_ids() -> list[uuid.UUID]:
    return [uuid7() for _ in range(2500)]


def test_thread_uniqueness() -> None:
    with ThreadPoolExecutor(max_workers=4) as executor:
        batches = list(executor.map(lambda _: _thread_ids(), range(4)))
    values = [value for batch in batches for value in batch]
    assert len(set(values)) == 10_000


def test_frozen_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    frozen = time.time_ns() + 1_000_000_000
    monkeypatch.setattr(time, "time_ns", lambda: frozen)
    values = [uuid7() for _ in range(10_000)]
    assert all(left.int < right.int for left, right in itertools.pairwise(values))
    assert uuid7_timestamp_ms(values[-1]) > uuid7_timestamp_ms(values[0])


def test_backwards_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = iter((time.time_ns() + 2_000_000_000, 0, 0))
    monkeypatch.setattr(time, "time_ns", lambda: next(clock))
    values = [uuid7() for _ in range(3)]
    assert values[0].int < values[1].int < values[2].int
    # A clock going backwards keeps the stored timestamp; only the counter advances.
    assert uuid7_timestamp_ms(values[2]) == uuid7_timestamp_ms(values[0])


def test_timestamp_rejects_other_versions() -> None:
    with pytest.raises(ValueError, match="version 7"):
        uuid7_timestamp_ms(uuid.uuid4())

import secrets
import threading
import time
import uuid

_lock = threading.Lock()
_timestamp_ms = -1
_counter = 0


def uuid7() -> uuid.UUID:
    """Return a process-monotonic UUID with an RFC 9562 millisecond timestamp."""
    global _timestamp_ms, _counter
    with _lock:
        now_ms = time.time_ns() // 1_000_000
        if now_ms > _timestamp_ms:
            _timestamp_ms = now_ms
            _counter = 0
        elif _counter < 4095:
            # Same millisecond, or the clock went backwards: keep the stored timestamp.
            _counter += 1
        else:
            # Counter exhausted: borrow the next millisecond to stay strictly increasing.
            _timestamp_ms += 1
            _counter = 0
        value = (
            (_timestamp_ms << 80) | (7 << 76) | (_counter << 64) | (2 << 62) | secrets.randbits(62)
        )
        return uuid.UUID(int=value)


def uuid7_timestamp_ms(value: uuid.UUID) -> int:
    """Extract the unsigned 48-bit timestamp from a version 7 UUID."""
    if value.version != 7:
        raise ValueError("A version 7 UUID is required")
    return value.int >> 80

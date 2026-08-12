"""Per-session state machine, event log, and live SSE streaming.

Pure infrastructure — no LLM calls here. This is what the live cascade UI (and
the audit trail) is built on: every state transition and log line any other
module wants to surface goes through `JobLog.emit`, and `sse_stream` turns
that into a stream a browser can render as it happens.

The registry (`get_log` / `drop_log`) is process-local, in-memory, keyed by
session_id — good enough for a single-instance hackathon backend.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from app.schemas import EventLogEntry, JobState

# Sentinel pushed onto subscriber queues by close() so live subscribe()
# generators can tell "job finished" apart from "an entry arrived".
_CLOSE_SENTINEL = object()


class JobLog:
    """Event log + state for one session.

    `emit` is plain sync code (callable from anywhere, no event loop
    required) that appends to the log and fans the entry out to every live
    subscriber's queue. `subscribe` replays the log so far and then streams
    whatever comes next, so a browser that connects mid-job still sees the
    full cascade from the start.
    """

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self._state: JobState = JobState.INTAKE
        self._entries: list[EventLogEntry] = []
        self._seq: int = 0
        self._subscribers: list[asyncio.Queue[EventLogEntry | object]] = []
        self._closed: bool = False

    @property
    def state(self) -> JobState:
        return self._state

    @property
    def entries(self) -> list[EventLogEntry]:
        return list(self._entries)

    def emit(
        self,
        *,
        actor: str,
        message: str,
        payload: dict[str, Any] | None = None,
        state_to: JobState | None = None,
    ) -> EventLogEntry:
        """Append an entry. If state_to is given, records the transition and moves state."""
        self._seq += 1
        state_from = self._state
        if state_to is not None:
            self._state = state_to

        entry = EventLogEntry(
            seq=self._seq,
            state_from=state_from,
            state_to=state_to,
            actor=actor,  # type: ignore[arg-type]  # pydantic validates against the Literal
            message=message,
            payload=payload or {},
            timestamp=datetime.now(UTC).isoformat(),
        )
        self._entries.append(entry)

        # Sync fan-out: no await here, so this is safe to call from any sync
        # code path without touching the event loop.
        for queue in self._subscribers:
            queue.put_nowait(entry)

        return entry

    async def subscribe(self) -> AsyncIterator[EventLogEntry]:
        """Yields past entries first (replay), then live ones as they arrive."""
        queue: asyncio.Queue[EventLogEntry | object] = asyncio.Queue()

        # Register before snapshotting. Both statements are synchronous (no
        # await between them) so, on a single-threaded event loop, no emit()
        # can interleave here — every future entry either lands in the
        # snapshot or gets pushed to `queue`, never both and never neither.
        already_closed = self._closed
        if not already_closed:
            self._subscribers.append(queue)
        snapshot = list(self._entries)

        for entry in snapshot:
            yield entry

        if already_closed:
            return

        try:
            while True:
                item = await queue.get()
                if item is _CLOSE_SENTINEL:
                    return
                yield item  # type: ignore[misc]  # only EventLogEntry or the sentinel is ever queued
        finally:
            if queue in self._subscribers:
                self._subscribers.remove(queue)

    def close(self) -> None:
        """Signals subscribers that the job is finished so their streams end."""
        self._closed = True
        for queue in self._subscribers:
            queue.put_nowait(_CLOSE_SENTINEL)


# --------------------------------------------------------------------------
# Registry
# --------------------------------------------------------------------------

_registry: dict[str, JobLog] = {}


def get_log(session_id: str) -> JobLog:
    """Returns the JobLog for a session, creating it on first use."""
    log = _registry.get(session_id)
    if log is None:
        log = JobLog(session_id)
        _registry[session_id] = log
    return log


def drop_log(session_id: str) -> None:
    """Removes a session's JobLog from the registry, if present."""
    _registry.pop(session_id, None)


# --------------------------------------------------------------------------
# SSE
# --------------------------------------------------------------------------


def sse_format(entry: EventLogEntry) -> str:
    """Returns a properly framed SSE chunk: 'event: <state_to or 'log'>\\ndata: <json>\\n\\n'."""
    event_name = entry.state_to.value if entry.state_to is not None else "log"
    data = entry.model_dump_json()
    # SSE frames one logical message per "data:" line; a literal newline in
    # the payload would break framing, so split defensively and prefix each
    # line (model_dump_json never emits raw newlines, but this costs nothing).
    data_lines = data.splitlines() or [""]
    data_block = "\n".join(f"data: {line}" for line in data_lines)
    return f"event: {event_name}\n{data_block}\n\n"


async def sse_stream(session_id: str) -> AsyncIterator[str]:
    """subscribe() + sse_format, ready to hand to fastapi.responses.StreamingResponse.

    Emits an initial ': connected' comment and a ping comment every 15s of
    silence so proxies don't drop the connection.
    """
    log = get_log(session_id)
    yield ": connected\n\n"

    agen = log.subscribe()
    try:
        while True:
            try:
                entry = await asyncio.wait_for(agen.__anext__(), timeout=15.0)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
                continue
            except StopAsyncIteration:
                return
            yield sse_format(entry)
    finally:
        await agen.aclose()

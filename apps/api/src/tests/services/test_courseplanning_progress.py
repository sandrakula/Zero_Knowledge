"""SSE progress-event conversion for the course-planning stream.

``generate_course_plan_stream`` yields in-band ``PROGRESS_PREFIX`` sentinels as
standalone chunks while materials are fetched and the plan is written. The
router's ``event_generator`` must turn those sentinels into ``progress`` SSE
events and leave ordinary text chunks as ``chunk`` events, preserving the
existing ``done`` event.
"""

import json

from src.routers.ai.courseplanning import event_generator
from src.services.ai.courseplanning import PROGRESS_PREFIX


async def _mixed_stream():
    yield PROGRESS_PREFIX + json.dumps({"stage": "transcripts", "done": 1, "total": 2})
    yield "hello"


async def test_progress_sentinel_becomes_progress_event_and_chunk_stays_chunk():
    events = [item async for item in event_generator(_mixed_stream(), "session-1")]

    assert len(events) == 3

    progress = json.loads(events[0].removeprefix("data: ").strip())
    assert progress == {
        "type": "progress",
        "stage": "transcripts",
        "done": 1,
        "total": 2,
    }

    chunk = json.loads(events[1].removeprefix("data: ").strip())
    assert chunk == {"type": "chunk", "content": "hello"}

    done = json.loads(events[2].removeprefix("data: ").strip())
    assert done == {"type": "done", "session_uuid": "session-1"}

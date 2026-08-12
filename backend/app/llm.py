"""Thin shared wrapper around the Anthropic SDK.

Every module calls Claude through here so model choice, caching and JSON parsing
are consistent (and switchable in one place).
"""

from __future__ import annotations

import json
import os
from typing import Any, TypeVar

import anthropic
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

# One model per stage so we can tune cost without touching call sites.
# The scorer runs once per source, so it is the one that adds up.
MODEL_SURVEY = os.getenv("MODEL_SURVEY", "claude-opus-4-6")
MODEL_EXTRACT = os.getenv("MODEL_EXTRACT", "claude-opus-4-6")
MODEL_SCORE = os.getenv("MODEL_SCORE", "claude-opus-4-6")
MODEL_AGGREGATE = os.getenv("MODEL_AGGREGATE", "claude-opus-4-6")

client = anthropic.AsyncAnthropic()


async def structured(
    *,
    model: str,
    system: str,
    user: str,
    schema: type[T],
    max_tokens: int = 8000,
    cache_system: bool = True,
) -> T:
    """Call Claude and get back a validated pydantic object.

    `cache_system` marks the system prompt as cacheable — worth it because the scorer
    reuses the same long system prompt for every source in the loop.

    Note: messages.parse() has no top-level `cache_control` parameter, so the breakpoint
    goes on the system block itself. Caching only kicks in above ~1024 tokens, which the
    scorer prompt clears and the shorter ones don't — that's fine, it just no-ops.
    """
    system_param: Any = system
    if cache_system:
        system_param = [
            {
                "type": "text",
                "text": system,
                "cache_control": {"type": "ephemeral"},
            }
        ]

    response = await client.messages.parse(
        model=model,
        max_tokens=max_tokens,
        system=system_param,
        messages=[{"role": "user", "content": user}],
        output_format=schema,
    )
    return response.parsed_output


async def text(
    *,
    model: str,
    system: str,
    user: str,
    max_tokens: int = 4000,
) -> str:
    """Plain text call, for the rare case we don't want a schema."""
    response = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return "".join(b.text for b in response.content if b.type == "text")


def safe_json(raw: str) -> Any:
    """Parse JSON that may be wrapped in a markdown fence."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw
        raw = raw.rsplit("```", 1)[0]
    return json.loads(raw)

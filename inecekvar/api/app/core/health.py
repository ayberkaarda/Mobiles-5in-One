"""Liveness endpoint. It reports only that the process answers (spec section 8: no details)."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

router = APIRouter(tags=["health"])


class HealthStatus(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status: Literal["ok"]


@router.get("/health", response_model=HealthStatus)
async def health() -> HealthStatus:
    return HealthStatus(status="ok")

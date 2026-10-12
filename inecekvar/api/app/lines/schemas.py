from pydantic import BaseModel, ConfigDict

from app.models import Line


class LineSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str
    code: str
    name: str
    mode: str


def summary(line: Line) -> LineSummary:
    return LineSummary(slug=line.slug, code=line.code, name=line.name, mode=line.mode)

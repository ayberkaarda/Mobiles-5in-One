import unicodedata
import uuid
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from app.geo import Coordinate, validate_coordinate, validate_polyline
from app.models.enums import LineMode, StopKind


def clean_text(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Metin gerekli.")
    if any(unicodedata.category(char).startswith("C") for char in value):
        raise ValueError("Denetim karakterleri kullanılamaz.")
    value = value.strip()
    if not value:
        raise ValueError("Metin boş olamaz.")
    return value


type Name = Annotated[str, BeforeValidator(clean_text), Field(min_length=1, max_length=160)]
type CitySlug = Annotated[str, BeforeValidator(clean_text), Field(min_length=1, max_length=80)]
type Fare = Annotated[int, Field(ge=0, le=10000000)]
type Location = Annotated[Coordinate, AfterValidator(validate_coordinate)]
type Payment = Literal["nakit", "kart", "istanbulkart"]


def check_geometry(value: list[Coordinate]) -> list[Coordinate]:
    validate_polyline(value)
    return value


def unique_stops(value: list[uuid.UUID]) -> list[uuid.UUID]:
    if len(set(value)) != len(value):
        raise ValueError("Duraklar yinelenemez.")
    return value


def unique_payments(value: list[Payment]) -> list[Payment]:
    if len(set(value)) != len(value):
        raise ValueError("Ödeme yöntemleri yinelenemez.")
    return value


type GeometryInput = Annotated[
    list[Coordinate],
    Field(min_length=2, max_length=5000),
    AfterValidator(check_geometry),
]
type StopIds = Annotated[
    list[uuid.UUID],
    Field(min_length=2, max_length=200),
    AfterValidator(unique_stops),
]
type Payments = Annotated[list[Payment], Field(max_length=3), AfterValidator(unique_payments)]
type Hours = Annotated[str, BeforeValidator(clean_text), Field(max_length=500)]
type HailNotes = Annotated[str, BeforeValidator(clean_text), Field(max_length=1000)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NewLine(StrictModel):
    kind: Literal["new_line"]
    city: CitySlug
    code: Annotated[
        str,
        BeforeValidator(clean_text),
        Field(
            min_length=1,
            max_length=32,
            pattern=r"^[A-Za-z0-9ÇĞİÖŞÜçğıöşü .\-/]+$",
        ),
    ]
    name: Name
    mode: LineMode
    geometry: GeometryInput | None = None
    trace_id: uuid.UUID | None = None
    geometry_source: Literal["trace"] | None = None
    photo_id: uuid.UUID | None = None
    stop_ids: StopIds
    fare_minor: Fare | None = None
    hours_text: Hours | None = None
    payment_methods: Payments = Field(default_factory=list)
    hail_notes: HailNotes | None = None

    @model_validator(mode="after")
    def geometry_choice(self) -> Self:
        if (self.geometry is None) == (self.trace_id is None):
            raise ValueError("Bir geometri veya iz gerekli.")
        return self


class LineChanges(StrictModel):
    geometry: GeometryInput | None = None
    trace_id: uuid.UUID | None = None
    geometry_source: Literal["trace"] | None = None
    stop_ids: StopIds | None = None
    fare_minor: Fare | None = None
    hours_text: Hours | None = None
    payment_methods: Payments | None = None
    hail_notes: HailNotes | None = None
    name: Name | None = None

    @model_validator(mode="after")
    def present(self) -> Self:
        if self.trace_id is not None and self.geometry is not None:
            raise ValueError("Tek geometri kaynagi gerekli.")
        if "trace_id" in self.model_fields_set and self.trace_id is None:
            raise ValueError("Iz bos olamaz.")
        if not self.model_fields_set:
            raise ValueError("En az bir değişiklik gerekli.")
        for field in ("geometry", "stop_ids", "payment_methods", "name"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError("Alan boş olamaz.")
        return self


class UpdateLine(StrictModel):
    kind: Literal["update_line"]
    line: uuid.UUID
    base_version_no: Annotated[int, Field(ge=1, le=2147483647)]
    changes: LineChanges
    photo_id: uuid.UUID | None = None


class NewStop(StrictModel):
    kind: Literal["new_stop"]
    city: CitySlug
    name: Name
    location: Location
    stop_kind: StopKind
    photo_id: uuid.UUID | None = None


class StopChanges(StrictModel):
    name: Name | None = None
    location: Location | None = None
    kind: StopKind | None = None

    @model_validator(mode="after")
    def present(self) -> Self:
        if not self.model_fields_set or any(
            getattr(self, field) is None for field in self.model_fields_set
        ):
            raise ValueError("En az bir değişiklik gerekli.")
        return self


class UpdateStop(StrictModel):
    kind: Literal["update_stop"]
    stop: uuid.UUID
    changes: StopChanges
    photo_id: uuid.UUID | None = None


class FareUpdate(StrictModel):
    kind: Literal["fare_update"]
    line: uuid.UUID
    base_version_no: Annotated[int, Field(ge=1, le=2147483647)]
    fare_minor: Fare
    photo_id: uuid.UUID | None = None


class Retire(StrictModel):
    kind: Literal["retire"]
    line: uuid.UUID
    reason: Annotated[str, BeforeValidator(clean_text), Field(min_length=1, max_length=500)]
    photo_id: uuid.UUID | None = None


type EditInput = Annotated[
    NewLine | UpdateLine | NewStop | UpdateStop | FareUpdate | Retire,
    Field(discriminator="kind"),
]


class EditOut(StrictModel):
    id: uuid.UUID
    kind: str
    state: str
    payload: dict[str, object]
    diff: dict[str, object] | list[object] | None
    reason: str | None
    created_at: datetime
    reviewed_at: datetime | None
    city: str

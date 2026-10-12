import uuid

from fastapi import APIRouter, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from app.auth.service import locked_user
from app.core.deps import DbDep, PrincipalDep
from app.core.errors import ProblemError
from app.models import City, Favorite, Line

router = APIRouter()


class FavoriteOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    line_id: uuid.UUID
    slug: str
    city: str


@router.get("/me/favorites")
async def list_favorites(db: DbDep, principal: PrincipalDep) -> list[FavoriteOut]:
    rows = await db.execute(
        select(Line.id, Line.slug, City.slug)
        .join(
            Favorite,
            Favorite.line_id == Line.id,
        )
        .join(City, City.id == Line.city_id)
        .where(
            Favorite.user_id == principal.user_id,
        )
        .order_by(City.slug, Line.slug)
    )
    return [FavoriteOut(line_id=identity, slug=slug, city=city) for identity, slug, city in rows]


@router.get("/me/favorites/{line_id}")
async def read_favorite(line_id: uuid.UUID, db: DbDep, principal: PrincipalDep) -> FavoriteOut:
    row = (
        await db.execute(
            select(Line.id, Line.slug, City.slug)
            .join(
                Favorite,
                Favorite.line_id == Line.id,
            )
            .join(City, City.id == Line.city_id)
            .where(
                Favorite.user_id == principal.user_id,
                Favorite.line_id == line_id,
            )
        )
    ).one_or_none()
    if row is None:
        raise ProblemError("favorite.not_found", 404)
    return FavoriteOut(line_id=row[0], slug=row[1], city=row[2])


@router.put("/me/favorites/{line_id}", status_code=204)
async def put_favorite(line_id: uuid.UUID, db: DbDep, principal: PrincipalDep) -> Response:
    await locked_user(db, principal.user_id)
    line = await db.scalar(
        select(Line)
        .where(
            Line.id == line_id,
            Line.status == "published",
        )
        .with_for_update()
    )
    if line is None:
        raise ProblemError("line.not_found", 404)
    await db.execute(
        insert(Favorite)
        .values(user_id=principal.user_id, line_id=line_id)
        .on_conflict_do_nothing(index_elements=[Favorite.user_id, Favorite.line_id])
    )
    await db.commit()
    return Response(status_code=204)


@router.delete("/me/favorites/{line_id}", status_code=204)
async def delete_favorite(line_id: uuid.UUID, db: DbDep, principal: PrincipalDep) -> Response:
    await db.execute(
        delete(Favorite).where(
            Favorite.user_id == principal.user_id,
            Favorite.line_id == line_id,
        )
    )
    await db.commit()
    return Response(status_code=204)

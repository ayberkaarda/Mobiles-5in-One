# Fixture for iv-python-sql-string-built (semgrep --test).
from sqlalchemy import select, text

from app.models import Line


async def positives(session, conn, city: str, table: str, limit: int) -> None:
    # ruleid: iv-python-sql-string-built
    await session.execute(text(f"SELECT * FROM lines WHERE city = '{city}'"))
    # ruleid: iv-python-sql-string-built
    await session.execute(text("SELECT * FROM lines WHERE city = '%s'" % city))
    # ruleid: iv-python-sql-string-built
    await session.execute(text("SELECT * FROM {} LIMIT 5".format(table)))
    # ruleid: iv-python-sql-string-built
    await session.execute(text("SELECT * FROM lines WHERE city = '" + city + "'"))
    # ruleid: iv-python-sql-string-built
    await conn.exec_driver_sql(f"DELETE FROM {table}")
    # ruleid: iv-python-sql-string-built
    conn.execute("SELECT * FROM lines LIMIT " + str(limit))
    statement = f"SELECT * FROM lines WHERE city = '{city}'"
    # ruleid: iv-python-sql-string-built
    await session.execute(text(statement))


async def negatives(session, conn, city: str) -> None:
    # ok: iv-python-sql-string-built
    await session.execute(text("SELECT * FROM lines WHERE city = :city"), {"city": city})
    # ok: iv-python-sql-string-built
    await session.execute(text("SELECT id FROM lines " "WHERE city = :city"), {"city": city})
    # ok: iv-python-sql-string-built
    await session.execute(select(Line).where(Line.city == city))
    # ok: iv-python-sql-string-built
    await session.execute(select(Line).where(Line.name.ilike(f"%{city}%", escape="\\")))
    # ok: iv-python-sql-string-built
    await conn.exec_driver_sql("SELECT 1")
    statement = "SELECT * FROM lines WHERE city = :city"
    # ok: iv-python-sql-string-built
    await session.execute(text(statement), {"city": city})
    query = select(Line).where(Line.name.ilike(f"%{city}%", escape="\\"))
    # ok: iv-python-sql-string-built
    await session.execute(query)

from collections.abc import AsyncGenerator

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session


def get_sync_session_factory() -> sessionmaker:
    """Create a sync sessionmaker for in-process background jobs."""
    sync_url = settings.DATABASE_URL.replace("+asyncpg", "+psycopg2")
    sync_engine = create_engine(sync_url, echo=False)
    return sessionmaker(bind=sync_engine, expire_on_commit=False)

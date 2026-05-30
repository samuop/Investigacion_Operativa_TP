from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from backend.models import Base

DATABASE_URL = "sqlite:///./eoq.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def init_db() -> None:
    """Crea todas las tablas si no existen."""
    Base.metadata.create_all(bind=engine)


def get_db():
    """Dependency de FastAPI para inyectar la sesion de base de datos."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

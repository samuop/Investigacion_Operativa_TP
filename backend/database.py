from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, Session
from backend.models import Base

DATABASE_URL = "sqlite:///./eoq.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def init_db() -> None:
    """Crea todas las tablas si no existen y aplica migraciones simples."""
    Base.metadata.create_all(bind=engine)
    _migrate_add_duration_ms()


def _migrate_add_duration_ms() -> None:
    """Agrega la columna messages.duration_ms en bases ya existentes."""
    inspector = inspect(engine)
    if "messages" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("messages")}
    if "duration_ms" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE messages ADD COLUMN duration_ms INTEGER"))


def get_db():
    """Dependency de FastAPI para inyectar la sesion de base de datos."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

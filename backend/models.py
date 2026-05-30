from sqlalchemy import Column, Integer, String, Float, DateTime, Text, ForeignKey
from sqlalchemy.orm import declarative_base
from datetime import datetime, timezone

Base = declarative_base()


class Config(Base):
    """Configuracion persistente del usuario: API key y modelo seleccionado."""
    __tablename__ = "config"

    id = Column(Integer, primary_key=True, default=1)
    api_key = Column(String, nullable=False)
    model = Column(String, nullable=False, default="gemini-2.0-flash")
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class Session(Base):
    """Sesion de chat — agrupa mensajes bajo un ID de conversacion."""
    __tablename__ = "sessions"

    id = Column(String, primary_key=True)  # UUID generado en el frontend
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    title = Column(String, default="Nueva sesion")


class Message(Base):
    """Mensaje individual dentro de una sesion."""
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False)
    role = Column(String, nullable=False)   # "user" o "assistant"
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class EOQLog(Base):
    """Log de cada calculo EOQ realizado con sus parametros y resultado."""
    __tablename__ = "eoq_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, ForeignKey("sessions.id"), nullable=True)
    D = Column(Float, nullable=False)
    K = Column(Float, nullable=False)
    c1 = Column(Float, nullable=False)
    T = Column(Float, nullable=False, default=1.0)
    q0_exacto = Column(Float, nullable=False)
    q0_redondeado = Column(Integer, nullable=False)
    CTE = Column(Float, nullable=False)
    numero_pedidos = Column(Float, nullable=False)
    tiempo_entre_pedidos_dias = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

import os
import uuid
import json
from contextlib import asynccontextmanager
from typing import Optional, AsyncGenerator

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai.types import Content, Part

from backend.database import init_db, get_db
from backend.models import Config, Session as DBSession, Message, EOQLog
from eoq_agent.agent import root_agent


# --------------------------------------------------------------------------- #
# Runner ADK global — se reinicia cuando el usuario cambia la config
# --------------------------------------------------------------------------- #

_runner: Optional[Runner] = None
_session_service = InMemorySessionService()
APP_NAME = "eoq_chatbot"


def build_runner(api_key: str, model: str) -> Runner:
    os.environ["GOOGLE_API_KEY"] = api_key
    os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "FALSE"
    os.environ["MODEL"] = model
    # Reimportar el agente con el modelo actualizado
    root_agent.model = model
    return Runner(
        agent=root_agent,
        app_name=APP_NAME,
        session_service=_session_service,
    )


# --------------------------------------------------------------------------- #
# Lifespan — inicializa la DB y el runner al arrancar
# --------------------------------------------------------------------------- #

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Cargar config guardada si existe
    from backend.database import SessionLocal
    db = SessionLocal()
    try:
        config = db.query(Config).first()
        if config:
            global _runner
            _runner = build_runner(config.api_key, config.model)
    finally:
        db.close()
    yield


app = FastAPI(title="EOQ Chatbot API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
# Schemas Pydantic
# --------------------------------------------------------------------------- #

class ConfigIn(BaseModel):
    api_key: str
    model: str = "gemini-2.0-flash"


class ConfigOut(BaseModel):
    model: str
    has_api_key: bool


class SessionOut(BaseModel):
    id: str
    title: str
    created_at: str


class MessageOut(BaseModel):
    role: str
    content: str
    created_at: str
    duration_ms: Optional[int] = None


class ChatIn(BaseModel):
    session_id: str
    message: str


class ChatOut(BaseModel):
    reply: str
    session_id: str


# --------------------------------------------------------------------------- #
# Endpoint para listar modelos disponibles con una API key
# --------------------------------------------------------------------------- #

class ModelsIn(BaseModel):
    api_key: str


@app.post("/models")
async def list_models(body: ModelsIn):
    """Devuelve los modelos Gemini disponibles para la API key dada.

    La key viaja en el body (no en la URL) para que no quede registrada
    en logs de acceso, historial del navegador ni cabeceras Referer.
    """
    import httpx
    api_key = body.api_key
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                "https://generativelanguage.googleapis.com/v1beta/models",
                headers={"x-goog-api-key": api_key},
            )
        if r.status_code == 400:
            raise HTTPException(status_code=400, detail="API key inválida.")
        if r.status_code == 403:
            raise HTTPException(status_code=403, detail="API key sin permisos.")
        r.raise_for_status()
        data = r.json()
        models = [
            m["name"].replace("models/", "")
            for m in data.get("models", [])
            if "generateContent" in m.get("supportedGenerationMethods", [])
            and m["name"].replace("models/", "").startswith("gemini")
        ]
        models.sort()
        return {"models": models}
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Timeout al consultar modelos.")


# --------------------------------------------------------------------------- #
# Endpoints de configuracion
# --------------------------------------------------------------------------- #

@app.get("/config", response_model=ConfigOut)
def get_config(db: Session = Depends(get_db)):
    config = db.query(Config).first()
    if not config:
        return ConfigOut(model="gemini-2.0-flash", has_api_key=False)
    return ConfigOut(model=config.model, has_api_key=bool(config.api_key))


class ConfigFull(BaseModel):
    api_key: str
    model: str


@app.get("/config/full", response_model=ConfigFull)
def get_config_full(db: Session = Depends(get_db)):
    config = db.query(Config).first()
    if not config:
        raise HTTPException(status_code=404, detail="No hay configuración guardada.")
    return ConfigFull(api_key=config.api_key, model=config.model)


@app.delete("/config")
def delete_config(db: Session = Depends(get_db)):
    global _runner
    config = db.query(Config).first()
    if config:
        db.delete(config)
        db.commit()
    _runner = None
    return {"ok": True}


@app.post("/config", response_model=ConfigOut)
def save_config(body: ConfigIn, db: Session = Depends(get_db)):
    global _runner
    config = db.query(Config).first()
    if config:
        config.api_key = body.api_key
        config.model = body.model
    else:
        config = Config(id=1, api_key=body.api_key, model=body.model)
        db.add(config)
    db.commit()
    _runner = build_runner(body.api_key, body.model)
    return ConfigOut(model=body.model, has_api_key=True)


# --------------------------------------------------------------------------- #
# Endpoints de sesiones
# --------------------------------------------------------------------------- #

@app.get("/sessions", response_model=list[SessionOut])
def list_sessions(db: Session = Depends(get_db)):
    sessions = db.query(DBSession).order_by(DBSession.created_at.desc()).all()
    return [
        SessionOut(
            id=s.id,
            title=s.title,
            created_at=s.created_at.isoformat(),
        )
        for s in sessions
    ]


@app.post("/sessions", response_model=SessionOut)
def create_session(db: Session = Depends(get_db)):
    session_id = str(uuid.uuid4())
    s = DBSession(id=session_id, title="Nueva sesion")
    db.add(s)
    db.commit()
    return SessionOut(id=s.id, title=s.title, created_at=s.created_at.isoformat())


class SessionPatch(BaseModel):
    title: str


@app.patch("/sessions/{session_id}", response_model=SessionOut)
def rename_session(session_id: str, body: SessionPatch, db: Session = Depends(get_db)):
    s = db.query(DBSession).filter(DBSession.id == session_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sesión no encontrada.")
    s.title = body.title[:60]
    db.commit()
    return SessionOut(id=s.id, title=s.title, created_at=s.created_at.isoformat())


@app.delete("/sessions/{session_id}")
def delete_session(session_id: str, db: Session = Depends(get_db)):
    s = db.query(DBSession).filter(DBSession.id == session_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sesión no encontrada.")
    db.query(Message).filter(Message.session_id == session_id).delete()
    db.query(EOQLog).filter(EOQLog.session_id == session_id).delete()
    db.delete(s)
    db.commit()
    return {"ok": True}


@app.get("/sessions/{session_id}/messages", response_model=list[MessageOut])
def get_messages(session_id: str, db: Session = Depends(get_db)):
    msgs = (
        db.query(Message)
        .filter(Message.session_id == session_id)
        .order_by(Message.created_at)
        .all()
    )
    return [
        MessageOut(
            role=m.role,
            content=m.content,
            created_at=m.created_at.isoformat(),
            duration_ms=m.duration_ms,
        )
        for m in msgs
    ]


# --------------------------------------------------------------------------- #
# Endpoint de chat
# --------------------------------------------------------------------------- #

@app.post("/chat", response_model=ChatOut)
async def chat(body: ChatIn, db: Session = Depends(get_db)):
    if not _runner:
        raise HTTPException(
            status_code=400,
            detail="No hay API key configurada. Ingresala en Configuracion antes de chatear.",
        )

    # Asegurar que la sesion existe en SQLite
    db_session = db.query(DBSession).filter(DBSession.id == body.session_id).first()
    if not db_session:
        db_session = DBSession(id=body.session_id, title=body.message[:40])
        db.add(db_session)
        db.commit()

    # Guardar mensaje del usuario
    db.add(Message(session_id=body.session_id, role="user", content=body.message))
    db.commit()

    # Asegurar sesion en ADK InMemory
    adk_session = await _session_service.get_session(
        app_name=APP_NAME, user_id="user", session_id=body.session_id
    )
    if not adk_session:
        await _session_service.create_session(
            app_name=APP_NAME, user_id="user", session_id=body.session_id
        )

    # Ejecutar el agente con manejo de errores de cuota
    try:
        content = Content(role="user", parts=[Part(text=body.message)])
        reply_text = ""
        async for event in _runner.run_async(
            user_id="user",
            session_id=body.session_id,
            new_message=content,
        ):
            if event.is_final_response() and event.content and event.content.parts:
                reply_text = event.content.parts[0].text or ""

    except Exception as e:
        err = str(e)
        if "429" in err or "RESOURCE_EXHAUSTED" in err:
            reply_text = (
                "Se alcanzo el limite diario de consultas de la API. "
                "Por favor intentá nuevamente mas tarde o cambia el modelo en Configuracion."
            )
        elif "503" in err or "UNAVAILABLE" in err:
            reply_text = (
                "El modelo esta experimentando alta demanda en este momento. "
                "Esperá unos segundos e intentá de nuevo."
            )
        else:
            reply_text = f"Ocurrio un error inesperado: {err}"

    # Guardar respuesta del agente
    db.add(Message(session_id=body.session_id, role="assistant", content=reply_text))

    # Actualizar titulo de la sesion con el primer mensaje
    if db_session.title == "Nueva sesion":
        db_session.title = body.message[:40]

    db.commit()

    # Log EOQ si el mensaje contiene un calculo
    _try_log_eoq(body.session_id, body.message, reply_text, db)

    return ChatOut(reply=reply_text, session_id=body.session_id)


@app.post("/chat/stream")
async def chat_stream(body: ChatIn, db: Session = Depends(get_db)):
    if not _runner:
        raise HTTPException(
            status_code=400,
            detail="No hay API key configurada. Ingresala en Configuracion antes de chatear.",
        )

    db_session = db.query(DBSession).filter(DBSession.id == body.session_id).first()
    if not db_session:
        db_session = DBSession(id=body.session_id, title=body.message[:40])
        db.add(db_session)
        db.commit()

    db.add(Message(session_id=body.session_id, role="user", content=body.message))
    db.commit()

    adk_session = await _session_service.get_session(
        app_name=APP_NAME, user_id="user", session_id=body.session_id
    )
    if not adk_session:
        await _session_service.create_session(
            app_name=APP_NAME, user_id="user", session_id=body.session_id
        )

    async def event_generator() -> AsyncGenerator[str, None]:
        import time
        full_reply = ""
        error_type = None
        started_at = time.perf_counter()
        try:
            content = Content(role="user", parts=[Part(text=body.message)])
            # No cortar con break: dejamos que el generador del ADK termine solo
            # para que OpenTelemetry cierre sus spans de tracing en el mismo
            # contexto async en que los creó (evita el ValueError de detach).
            async for event in _runner.run_async(
                user_id="user",
                session_id=body.session_id,
                new_message=content,
            ):
                if event.is_final_response() and event.content and event.content.parts:
                    full_reply = event.content.parts[0].text or ""

        except Exception as e:
            err = str(e)
            if "429" in err or "RESOURCE_EXHAUSTED" in err:
                error_type = "quota"
            elif "503" in err or "UNAVAILABLE" in err:
                error_type = "unavailable"
            elif "401" in err or "API_KEY" in err or "invalid" in err.lower():
                error_type = "invalid_key"
            else:
                error_type = "unknown"
                full_reply = err

        if error_type:
            yield f"data: {json.dumps({'error': error_type, 'raw': full_reply})}\n\n"
            return

        duration_ms = int((time.perf_counter() - started_at) * 1000)

        # Guardar en DB
        db.add(Message(
            session_id=body.session_id,
            role="assistant",
            content=full_reply,
            duration_ms=duration_ms,
        ))
        if db_session.title == "Nueva sesion":
            db_session.title = body.message[:40]
        db.commit()
        _try_log_eoq(body.session_id, body.message, full_reply, db)

        yield f"data: {json.dumps({'reply': full_reply, 'duration_ms': duration_ms})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _try_log_eoq(session_id: str, user_msg: str, reply: str, db: Session) -> None:
    """Intenta extraer y loguear un calculo EOQ de la respuesta del agente."""
    import re
    if "q0_exacto" not in reply and "q0_redondeado" not in reply:
        # Buscar patron en la respuesta para detectar calculos
        q0_match = re.search(r"q0[^=]*=\s*([\d,.]+)", reply, re.IGNORECASE)
        cte_match = re.search(r"CTE[^=\$]*[\$\s]*([\d,.]+)", reply, re.IGNORECASE)
        if not q0_match:
            return

    # Extraer parametros del mensaje del usuario con regex simple
    try:
        D = float(re.search(r"D\s*=\s*([\d.]+)", user_msg, re.IGNORECASE).group(1))
        K = float(re.search(r"K\s*=\s*([\d.]+)", user_msg, re.IGNORECASE).group(1))
        c1 = float(re.search(r"c1\s*=\s*([\d.]+)", user_msg, re.IGNORECASE).group(1))
        T_match = re.search(r"T\s*=\s*([\d.]+)", user_msg, re.IGNORECASE)
        T = float(T_match.group(1)) if T_match else 1.0

        from eoq_agent.tools import calcular_eoq
        result = calcular_eoq(D=D, K=K, c1=c1, T=T)
        if "error" not in result:
            db.add(EOQLog(
                session_id=session_id,
                D=D, K=K, c1=c1, T=T,
                q0_exacto=result["q0_exacto"],
                q0_redondeado=result["q0_redondeado"],
                CTE=result["CTE_exacto"],
                numero_pedidos=result["numero_pedidos"],
                tiempo_entre_pedidos_dias=result["tiempo_entre_pedidos_dias"],
            ))
            db.commit()
    except (AttributeError, KeyError, TypeError):
        pass


# --------------------------------------------------------------------------- #
# Endpoint de logs EOQ
# --------------------------------------------------------------------------- #

@app.get("/eoq-logs")
def get_eoq_logs(db: Session = Depends(get_db)):
    logs = db.query(EOQLog).order_by(EOQLog.created_at.desc()).limit(50).all()
    return [
        {
            "id": log.id,
            "session_id": log.session_id,
            "D": log.D, "K": log.K, "c1": log.c1, "T": log.T,
            "q0_exacto": log.q0_exacto,
            "q0_redondeado": log.q0_redondeado,
            "CTE": log.CTE,
            "numero_pedidos": log.numero_pedidos,
            "tiempo_entre_pedidos_dias": log.tiempo_entre_pedidos_dias,
            "created_at": log.created_at.isoformat(),
        }
        for log in logs
    ]

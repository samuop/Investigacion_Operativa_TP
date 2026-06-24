"""Modo voz en tiempo real con la Gemini Live API.

Canal paralelo e independiente del chat de texto (ADK). El navegador abre un
WebSocket contra /ws/voice; este backend hace de relay hacia la Live API de
Gemini (la API key nunca viaja al navegador) y ejecuta las herramientas EOQ
cuando el modelo las solicita vía function calling.

La Live API NO reusa el root_agent de ADK: las tools se re-declaran acá en el
formato FunctionDeclaration y se ejecutan a mano (send_tool_response), pero la
lógica se reusa tal cual desde eoq_agent/tools.py.
"""
import asyncio
import base64
import json
import logging
import os
import sys
import traceback
from typing import Any, Optional

_logger = logging.getLogger("voice")


class _VoiceLog:
    """Logger que SIEMPRE imprime a stdout (uvicorn lo muestra), además del
    logging estándar. Evita que los mensajes 'info' de un logger custom queden
    filtrados por la config de uvicorn."""

    @staticmethod
    def _emit(level: str, msg: str, *args) -> None:
        text = msg % args if args else msg
        print(f"[VOZ {level}] {text}", file=sys.stdout, flush=True)

    def info(self, msg, *args):
        self._emit("INFO", msg, *args)

    def warning(self, msg, *args):
        self._emit("WARN", msg, *args)

    def error(self, msg, *args):
        self._emit("ERROR", msg, *args)


log = _VoiceLog()

from google import genai
from google.genai import types
from starlette.websockets import WebSocketDisconnect

from eoq_agent.tools import (
    calcular_eoq,
    validar_parametros,
    explicar_concepto,
    modo_practica,
    generar_grafico,
)

# Modelo Live: se puede sobreescribir con la env var LIVE_MODEL si la key
# habilita otro nombre. Nota: los modelos Live NO aparecen en /models (Google
# no los lista), pero sí aceptan la conexión bidireccional si la cuenta tiene
# acceso. Verificado funcionando con esta key en AI Studio.
LIVE_MODEL = os.environ.get("LIVE_MODEL", "gemini-3.1-flash-live-preview")

# Audio: la Live API recibe PCM 16-bit mono a 16 kHz y emite a 24 kHz.
INPUT_SAMPLE_RATE = 16000
OUTPUT_SAMPLE_RATE = 24000


# --------------------------------------------------------------------------- #
# Declaración de las herramientas EOQ en formato Live API
# --------------------------------------------------------------------------- #

# Schema reutilizable: D, K, c1 y T (T opcional, default 1).
_PARAMS_EOQ = {
    "type": "object",
    "properties": {
        "D": {"type": "number", "description": "Demanda total del período (unidades)."},
        "K": {"type": "number", "description": "Costo fijo por pedido ($/pedido)."},
        "c1": {"type": "number", "description": "Costo de mantenimiento por unidad por período."},
        "T": {"type": "number", "description": "Duración del período en años (default 1)."},
    },
    "required": ["D", "K", "c1"],
}

FUNCTION_DECLARATIONS = [
    {
        "name": "calcular_eoq",
        "description": "Calcula el lote óptimo (q0) y el Costo Total Esperado (CTE) con el Modelo de Wilson.",
        "parameters": _PARAMS_EOQ,
    },
    {
        "name": "validar_parametros",
        "description": "Valida que los parámetros para el cálculo EOQ sean numéricos y positivos.",
        "parameters": _PARAMS_EOQ,
    },
    {
        "name": "explicar_concepto",
        "description": "Explica un concepto del Modelo EOQ/Wilson (eoq, demanda, cte, supuestos, formula, etc.).",
        "parameters": {
            "type": "object",
            "properties": {
                "concepto": {
                    "type": "string",
                    "description": "Concepto a explicar: eoq, demanda, costo_pedido, costo_mantenimiento, cte, supuestos, formula, restricciones.",
                },
            },
            "required": ["concepto"],
        },
    },
    {
        "name": "modo_practica",
        "description": "Genera un ejercicio de práctica del modelo EOQ con un escenario inventado y su solución.",
        "parameters": {
            "type": "object",
            "properties": {
                "ejercicio": {"type": "integer", "description": "Parámetro de compatibilidad (default 1)."},
            },
        },
    },
    {
        "name": "generar_grafico",
        "description": "Genera una URL de gráfico con las curvas de costo del Modelo EOQ.",
        "parameters": _PARAMS_EOQ,
    },
    {
        "name": "finalizar_llamada",
        "description": (
            "Termina la llamada de voz. Usala SOLO cuando la conversación llegó "
            "naturalmente a su fin: el usuario se despide (dice 'chau', 'gracias, "
            "nada más', 'listo', etc.) o confirma que no necesita más ayuda. "
            "Antes de finalizar, despedite brevemente en voz."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "motivo": {
                    "type": "string",
                    "description": "Motivo breve del cierre (ej: 'el usuario se despidió').",
                },
            },
        },
    },
]

# Nombre de la tool que cierra la llamada (no ejecuta lógica EOQ).
FINALIZAR_TOOL = "finalizar_llamada"

# Mapa nombre -> función real (las de tools.py son síncronas y puras).
_DISPATCH = {
    "calcular_eoq": calcular_eoq,
    "validar_parametros": validar_parametros,
    "explicar_concepto": explicar_concepto,
    "modo_practica": modo_practica,
    "generar_grafico": generar_grafico,
}


def _ejecutar_tool(name: str, args: dict[str, Any]) -> dict:
    """Ejecuta la herramienta solicitada y devuelve siempre un dict serializable."""
    fn = _DISPATCH.get(name)
    if fn is None:
        return {"error": f"Herramienta desconocida: {name}"}
    try:
        result = fn(**(args or {}))
    except Exception as e:  # noqa: BLE001 — nunca tirar la sesión por una tool
        return {"error": f"Error ejecutando {name}: {e}"}
    # explicar_concepto devuelve str; el resto dict. Normalizamos a dict.
    if isinstance(result, str):
        return {"resultado": result}
    return result


# --------------------------------------------------------------------------- #
# Prompt específico para VOZ
# --------------------------------------------------------------------------- #
# La voz es un contexto distinto al texto: el usuario ESCUCHA, no ve nada.
# Por eso no reusamos el SYSTEM_PROMPT de texto (que asume markdown, tablas,
# gráficos). Este prompt además explica cómo funcionan las herramientas por
# dentro, para que el asistente pueda explicar su razonamiento si se lo piden.

VOICE_SYSTEM_PROMPT = """Sos un asistente de voz especializado en el **Modelo EOQ (Cantidad Económica de Pedido)**, también llamado **Modelo de Wilson**, para gestión de inventarios. Estás en una **llamada de voz**: el usuario te ESCUCHA. A tu lado hay un panel que muestra la transcripción en vivo y los gráficos que generes.

## Reglas de la conversación por voz (críticas)
- Comunicá todo lo importante HABLANDO: lo principal tiene que entenderse solo escuchándote. El panel es un apoyo visual, no un reemplazo de tu explicación.
- Hablá en español rioplatense, natural y conversacional, como en una llamada. Frases cortas. Una idea por vez.
- NUNCA leas markdown, símbolos, ni notación. No digas "asterisco", "almohadilla" ni "barra". Nada de LaTeX.
- Al decir números, redondealos de forma hablable: "alrededor de 110 unidades", "unos 87 mil pesos". No recites decimales largos.
- Para los gráficos: cuando un cálculo se entienda mejor con la curva de costos, ofrecé generarlo y usá `generar_grafico`. El gráfico aparece en el panel al costado; avisale al usuario ("te lo muestro en el panel") y explicá en voz qué se ve (la curva en U, dónde está el óptimo).
- Sé breve. Si la respuesta es larga, dale lo esencial y preguntá si quiere más detalle.

## Cómo funcionan tus herramientas por dentro (para que puedas explicar tu razonamiento)
Tenés herramientas que hacen los cálculos. Si el usuario te pregunta "¿cómo lo calculaste?", explicá el método con estas fórmulas, en palabras:

- **calcular_eoq**: calcula el lote óptimo con la fórmula de Wilson. En palabras: "la raíz cuadrada de dos por el costo de pedido por la demanda, dividido el costo de mantener por el período". En símbolos internos: q0 = raíz(2·K·D / (T·c1)).
- El **Costo Total Esperado (CTE)** equilibra dos costos: el de hacer pedidos (la demanda dividida el lote, por el costo de pedido) más el de mantener stock (la mitad del lote, por el período, por el costo de mantener). El óptimo es donde esos dos costos se igualan.
- **El número de pedidos** es la demanda dividida el lote óptimo. **El tiempo entre pedidos** es el período dividido ese número de pedidos.
- **validar_parametros**: chequea que demanda, costo de pedido y costo de mantener sean positivos antes de calcular.
- **explicar_concepto**: trae la explicación de conceptos (supuestos, CTE, demanda, etc.).
- **modo_practica**: inventa un ejercicio nuevo con su solución.
- **generar_grafico**: genera el gráfico de las curvas de costo (pedido, mantenimiento y total). El gráfico se muestra en el panel al costado. Usala cuando ayude a visualizar el óptimo, y explicá en voz qué representa.

Cuando uses una herramienta, contale al usuario el resultado en voz; si pregunta el porqué, explicá la fórmula como arriba. Nunca te limites a decir "llamé a una herramienta": explicá el cálculo de verdad.

## Fidelidad estricta a los datos
Nunca inventes ni cambies un número. Todo número que digas tiene que venir o del usuario (tal cual te lo dijo) o del resultado exacto de una herramienta. Si no, no lo digas.

## Parámetros del modelo
- Demanda (D): cuántas unidades se necesitan en el período.
- Costo de pedido (K): lo que cuesta hacer un pedido, fijo.
- Costo de mantener (c1): lo que cuesta tener una unidad guardada por período.
- Período (T): la duración, normalmente un año.

Para el modo práctica, no reveles la solución hasta que el usuario intente resolverlo.

## Finalizar la llamada
Tenés la herramienta `finalizar_llamada`. Usala cuando la conversación llegó naturalmente a su fin: el usuario se despide ("chau", "gracias, era todo", "listo", "nada más") o confirma que no necesita más ayuda. Antes de llamarla, despedite con una frase breve y cálida (por ejemplo: "¡Listo! Que tengas un buen día, chau."). No la uses si el usuario sigue con dudas o en medio de un tema."""


# Mensaje interno que dispara la presentación del bot al iniciar la llamada.
# No lo dice el usuario: es una instrucción para que el bot rompa el hielo.
GREETING_TRIGGER = (
    "[INICIO DE LLAMADA] Presentate brevemente en voz: saludá, decí que sos un "
    "asistente de voz sobre el Modelo EOQ (Cantidad Económica de Pedido) y que "
    "este es un proyecto de la materia Investigación Operativa. Después ofrecé "
    "ayuda (calcular el lote óptimo, explicar conceptos o practicar con ejercicios) "
    "y preguntá en qué podés ayudar. Hacelo corto y cálido, en una o dos frases."
)

# Voz fija para que todas las llamadas suenen igual (mismo timbre/tono).
# Voces prebuilt de la Live API: Zephyr, Puck, Charon, Kore, Fenrir, Aoede...
VOICE_NAME = os.environ.get("LIVE_VOICE", "Zephyr")


def build_live_config() -> types.LiveConnectConfig:
    """Config de la sesión Live: voz, prompt específico de voz y las tools."""
    return types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        # Voz e idioma fijos: garantiza el mismo timbre en cada llamada.
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=VOICE_NAME),
            ),
            language_code="es-US",
        ),
        system_instruction=types.Content(
            parts=[types.Part(text=VOICE_SYSTEM_PROMPT)],
        ),
        tools=[{"function_declarations": FUNCTION_DECLARATIONS}],
        # Transcripción en vivo de ambos lados (para el panel lateral):
        # lo que dice el usuario (input) y lo que dice el bot (output).
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        # Detección automática de actividad de voz (VAD) explícita: alta
        # sensibilidad al fin del habla y ~0.8 s de silencio para cerrar el
        # turno. Evita que el turno quede colgado esperando.
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(
                start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH,
                end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_HIGH,
                prefix_padding_ms=100,
                silence_duration_ms=800,
            ),
        ),
    )


# --------------------------------------------------------------------------- #
# Relay WebSocket  navegador <-> Gemini Live
# --------------------------------------------------------------------------- #

# Protocolo con el navegador (JSON sobre el WebSocket):
#   cliente -> servidor:
#     {"type": "audio", "data": "<base64 PCM16 16kHz>"}   fragmento de micrófono
#     {"type": "end"}                                     fin del turno del usuario (opcional)
#   servidor -> cliente:
#     {"type": "ready"}                                   sesión Live abierta
#     {"type": "audio", "data": "<base64 PCM16 24kHz>"}   fragmento de audio del bot
#     {"type": "tool", "name": "...", "args": {...}}      el bot invocó una herramienta (UI)
#     {"type": "interrupted"}                             el usuario interrumpió: vaciar cola
#     {"type": "turn_complete"}                           el bot terminó de hablar
#     {"type": "transcript", "role": "user|assistant", "text": "...", "final": bool}
#                                                         transcripción en vivo
#     {"type": "chart", "url": "..."}                     gráfico generado (QuickChart)
#     {"type": "bye", "motivo": "..."}                    el bot decidió finalizar la llamada
#     {"type": "error", "message": "..."}                 error fatal


async def run_voice_relay(ws, api_key: str) -> None:
    """Relay bidireccional entre el WebSocket del navegador y la Live API.

    `ws` es un starlette/FastAPI WebSocket ya aceptado. `api_key` se lee de la
    config en SQLite (nunca llega del navegador).
    """
    log.info("=== run_voice_relay INICIADO (handler alcanzado) ===")
    client = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})
    config = build_live_config()

    try:
        log.info("Conectando a Live API modelo=%s", LIVE_MODEL)
        async with client.aio.live.connect(model=LIVE_MODEL, config=config) as session:
            await ws.send_json({"type": "ready"})
            log.info("Sesión Live abierta; relay activo")
            chunks_in = 0
            # Señal de cierre cuando el bot invoca finalizar_llamada.
            end_event = asyncio.Event()
            end_reason: dict[str, str] = {}

            # Saludo inicial: el bot se presenta antes de que el usuario hable.
            # Mandamos un turno (no se muestra; solo dispara la respuesta hablada).
            await session.send_client_content(
                turns={"role": "user", "parts": [{"text": GREETING_TRIGGER}]},
                turn_complete=True,
            )
            log.info("Saludo inicial disparado")

            async def browser_to_gemini() -> None:
                """Lee audio del navegador y lo reenvía a Gemini."""
                nonlocal chunks_in
                log.info("[B->G] pump arrancado, esperando audio del navegador")
                try:
                    while True:
                        msg = await ws.receive_json()
                        mtype = msg.get("type")
                        if mtype == "audio":
                            raw = base64.b64decode(msg["data"])
                            chunks_in += 1
                            if chunks_in == 1:
                                log.info("[B->G] primer chunk de audio recibido (%d bytes)", len(raw))
                            elif chunks_in % 50 == 0:
                                log.info("[B->G] %d chunks de audio enviados a Gemini", chunks_in)
                            await session.send_realtime_input(
                                audio=types.Blob(
                                    data=raw,
                                    mime_type=f"audio/pcm;rate={INPUT_SAMPLE_RATE}",
                                )
                            )
                        elif mtype == "end":
                            log.info("[B->G] navegador señaló fin de turno (audio_stream_end)")
                            await session.send_realtime_input(audio_stream_end=True)
                        elif mtype == "close":
                            log.info("[B->G] navegador pidió cerrar (chunks_in=%d) -> pump termina", chunks_in)
                            return
                        else:
                            log.warning("[B->G] mensaje desconocido del navegador: type=%r", mtype)
                except WebSocketDisconnect as e:
                    log.info("[B->G] WebSocket cerrado por el NAVEGADOR (code=%s, chunks_in=%d)",
                             getattr(e, "code", "?"), chunks_in)
                    return
                except Exception:
                    log.error("[B->G] pump MURIÓ con excepción (chunks_in=%d):\n%s",
                              chunks_in, traceback.format_exc())
                    raise

            async def gemini_to_browser() -> None:
                """Lee las respuestas de Gemini turno a turno y las reenvía.

                IMPORTANTE: session.receive() termina al final de CADA turno del
                modelo (es su diseño). Para una conversación continua hay que
                volver a llamarlo en un bucle, manteniendo la MISMA sesión viva.
                """
                try:
                    turno = 0
                    while True:
                        turno += 1
                        log.info("[G->B] esperando turno #%d de Gemini...", turno)
                        await _gemini_to_browser_loop(ws, session)
                        # receive() terminó este turno; volvemos a esperar el próximo.
                except Exception:
                    log.error("gemini_to_browser murió:\n%s", traceback.format_exc())
                    raise

            async def _gemini_to_browser_loop(ws, session) -> None:
                msg_count = 0
                audio_out_chunks = 0
                turns = 0
                log.info("[G->B] pump arrancado, esperando respuestas de Gemini")
                async for response in session.receive():
                    msg_count += 1
                    # Señal de que el servidor va a cerrar pronto la conexión.
                    if getattr(response, "go_away", None):
                        ga = response.go_away
                        log.warning("[G->B] Gemini envió GO_AWAY (time_left=%s) -- el servidor "
                                    "va a cerrar la sesión", getattr(ga, "time_left", None))
                    # 1) Herramientas: ejecutar y devolver el resultado.
                    if response.tool_call:
                        for fc in response.tool_call.function_calls:
                            args = dict(fc.args) if fc.args else {}
                            log.info("[G->B] TOOL CALL: %s(%s)", fc.name, args)
                            # Tool especial: el bot decidió finalizar la llamada.
                            if fc.name == FINALIZAR_TOOL:
                                motivo = args.get("motivo", "")
                                log.info("[G->B] el bot pidió FINALIZAR la llamada (motivo=%r)", motivo)
                                await session.send_tool_response(
                                    function_responses=[types.FunctionResponse(
                                        id=fc.id, name=fc.name,
                                        response={"ok": True},
                                    )]
                                )
                                # Marcamos cierre: tras la despedida del bot
                                # (turn_complete) terminamos el relay.
                                end_event.set()
                                end_reason["motivo"] = motivo
                                continue
                            await ws.send_json(
                                {"type": "tool", "name": fc.name, "args": args}
                            )
                            result = _ejecutar_tool(fc.name, args)
                            log.info("[G->B] tool %s ejecutada -> %s", fc.name,
                                     "error" if (isinstance(result, dict) and result.get("error")) else "ok")
                            # Si generó un gráfico, mandamos la URL al panel.
                            if fc.name == "generar_grafico" and isinstance(result, dict):
                                url = result.get("url_grafico")
                                if url:
                                    await ws.send_json({"type": "chart", "url": url})
                                    log.info("[G->B] gráfico enviado al panel")
                            await session.send_tool_response(
                                function_responses=[types.FunctionResponse(
                                    id=fc.id, name=fc.name, response=result,
                                )]
                            )
                        continue

                    sc = response.server_content
                    if sc is None:
                        # Puede venir audio directo en response.data.
                        if response.data:
                            audio_out_chunks += 1
                            await ws.send_json({
                                "type": "audio",
                                "data": base64.b64encode(response.data).decode("ascii"),
                            })
                        continue

                    # Transcripciones en vivo (panel lateral).
                    in_tr = getattr(sc, "input_transcription", None)
                    if in_tr and in_tr.text:
                        await ws.send_json({
                            "type": "transcript", "role": "user",
                            "text": in_tr.text, "final": bool(getattr(in_tr, "finished", False)),
                        })
                    out_tr = getattr(sc, "output_transcription", None)
                    if out_tr and out_tr.text:
                        await ws.send_json({
                            "type": "transcript", "role": "assistant",
                            "text": out_tr.text, "final": bool(getattr(out_tr, "finished", False)),
                        })

                    # 2) Interrupción: el usuario habló encima del bot.
                    if sc.interrupted:
                        log.info("[G->B] INTERRUPCIÓN (el usuario habló encima del bot)")
                        await ws.send_json({"type": "interrupted"})

                    # 3) Audio del modelo.
                    if sc.model_turn and sc.model_turn.parts:
                        for part in sc.model_turn.parts:
                            inline = getattr(part, "inline_data", None)
                            if inline and inline.data:
                                audio_out_chunks += 1
                                if audio_out_chunks == 1:
                                    log.info("[G->B] primer chunk de audio del bot -> navegador")
                                await ws.send_json({
                                    "type": "audio",
                                    "data": base64.b64encode(inline.data).decode("ascii"),
                                })

                    # 4) Fin de turno del bot.
                    if sc.turn_complete:
                        turns += 1
                        log.info("[G->B] TURN_COMPLETE #%d (audio_chunks_out=%d) -- el bot "
                                 "terminó de hablar; sigo escuchando", turns, audio_out_chunks)
                        await ws.send_json({"type": "turn_complete"})
                        # Si el bot pidió finalizar, este turn_complete es su
                        # despedida: avisamos al navegador y cerramos el relay.
                        if end_event.is_set():
                            log.info("[G->B] despedida emitida -> enviando 'bye' y cerrando")
                            await ws.send_json({"type": "bye", "motivo": end_reason.get("motivo", "")})
                            return
                log.info("[G->B] receive() cerró el turno tras %d mensajes "
                         "(audio_out=%d) -- vuelvo a esperar el próximo turno",
                         msg_count, audio_out_chunks)

            # Corremos ambas bombas en paralelo; si una termina/falla, cancelamos.
            recv_task = asyncio.create_task(gemini_to_browser(), name="gemini_to_browser")
            send_task = asyncio.create_task(browser_to_gemini(), name="browser_to_gemini")
            done, pending = await asyncio.wait(
                {recv_task, send_task}, return_when=asyncio.FIRST_COMPLETED
            )
            # ¿Cuál terminó primero? Esto nos dice quién cerró la llamada.
            for t in done:
                log.warning("[RELAY] el pump '%s' terminó PRIMERO -> se cierra la llamada",
                            t.get_name())
            for t in pending:
                log.info("[RELAY] cancelando pump pendiente '%s'", t.get_name())
                t.cancel()
            # Propagar excepción real (no la de cancelación) si la hubo.
            for t in done:
                exc = t.exception()
                if exc and not isinstance(exc, asyncio.CancelledError):
                    log.error("[RELAY] el pump '%s' terminó por EXCEPCIÓN", t.get_name())
                    raise exc
            log.info("[RELAY] relay finalizado (chunks_in=%d)", chunks_in)

    except Exception as e:  # noqa: BLE001
        log.error("[RELAY] excepción fatal en run_voice_relay:\n%s", traceback.format_exc())
        await _safe_error(ws, _explicar_error_live(e))


def _explicar_error_live(e: Exception) -> str:
    """Traduce errores típicos de la Live API a un mensaje accionable."""
    err = str(e)
    low = err.lower()
    if "not found" in low or "not supported" in low or "404" in err:
        return (
            f"El modelo de voz '{LIVE_MODEL}' no está disponible para tu API key. "
            "La Live API requiere un proyecto con acceso habilitado."
        )
    if "429" in err or "resource_exhausted" in low or "quota" in low:
        return "Se alcanzó el límite de cuota de la Live API. Intentá más tarde."
    if "401" in err or "permission" in low or "api key" in low or "invalid" in low:
        return "API key inválida o sin permisos para la Live API."
    return f"Error en la sesión de voz: {err}"


async def _safe_error(ws, message: str) -> None:
    try:
        await ws.send_json({"type": "error", "message": message})
    except Exception:  # noqa: BLE001 — el socket pudo cerrarse ya
        pass

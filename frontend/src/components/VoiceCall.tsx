import { useEffect, useRef, useState, useCallback } from "react";
import { Mic, MicOff, PhoneOff, X, Wrench } from "lucide-react";
import { VOICE_WS_URL } from "../api";

interface Props {
  onClose: () => void;
}

type Status = "connecting" | "listening" | "speaking" | "thinking" | "error" | "closed";

const OUTPUT_SAMPLE_RATE = 24000; // la Live API emite a 24 kHz

// Nombres legibles para las tools (para el log visible en la llamada)
const TOOL_LABELS: Record<string, string> = {
  calcular_eoq: "Calculando EOQ",
  validar_parametros: "Validando parámetros",
  explicar_concepto: "Explicando concepto",
  modo_practica: "Generando ejercicio",
  generar_grafico: "Generando gráfico",
};

const INACTIVITY_MS = 60_000; // cierre automático tras 1 min sin que el usuario hable

export default function VoiceCall({ onClose }: Props) {
  const [status, setStatus] = useState<Status>("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toolLog, setToolLog] = useState<string[]>([]);
  // Mensaje de cierre (despedida del bot o inactividad), para mostrarlo al cerrar.
  const [closeNote, setCloseNote] = useState<string | null>(null);

  // Refs de audio/red — no provocan re-render.
  const wsRef = useRef<WebSocket | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  // Cola de reproducción: programamos cada chunk justo después del anterior.
  const nextPlayTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cuando el bot habla, dejamos de enviar el micrófono para no captar el eco
  // del propio bot (que provocaría falsas interrupciones).
  const botSpeakingRef = useRef(false);

  // onClose en un ref para que los callbacks no se recreen cuando el padre
  // pasa una función inline distinta en cada render (evita reiniciar la llamada).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Timer de inactividad: cierra la llamada si el usuario no habla por 1 min.
  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Marca de tiempo del último audio enviado por el usuario (para no resetear
  // el timer con cada chunk, solo loguear actividad real).
  const lastUserSpeechRef = useRef<number>(0);

  const cleanup = useCallback(() => {
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
    try { workletNodeRef.current?.disconnect(); } catch {}
    workletNodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try { micCtxRef.current?.close(); } catch {}
    micCtxRef.current = null;
    try { playCtxRef.current?.close(); } catch {}
    playCtxRef.current = null;
    activeSourcesRef.current = [];
    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
  }, []);

  // Cierra la llamada con un motivo opcional (despedida / inactividad).
  const closeCall = useCallback((note?: string) => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    try { wsRef.current?.send(JSON.stringify({ type: "close" })); } catch {}
    if (note) {
      setCloseNote(note);
      setStatus("closed");
      cleanup();
      // Damos un par de segundos para que el usuario lea el motivo antes de cerrar.
      setTimeout(() => onCloseRef.current(), 2500);
    } else {
      cleanup();
      onCloseRef.current();
    }
  }, [cleanup]);

  // (Re)arranca el temporizador de inactividad: 1 min sin que el usuario hable.
  const armInactivityTimer = useCallback(() => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    inactivityRef.current = setTimeout(() => {
      closeCall("Llamada finalizada por inactividad.");
    }, INACTIVITY_MS);
  }, [closeCall]);

  // Vacía la cola de reproducción (cuando el usuario interrumpe al bot).
  const stopPlayback = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try { src.stop(); } catch {}
    }
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
    botSpeakingRef.current = false; // reabrir el micro al interrumpir
  }, []);

  // Reproduce un chunk PCM16 24kHz que llega del bot.
  const playChunk = useCallback((bytes: ArrayBuffer) => {
    const ctx = playCtxRef.current;
    if (!ctx) return;

    const pcm = new Int16Array(bytes);
    const float = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) float[i] = pcm[i] / 0x8000;

    const buffer = ctx.createBuffer(1, float.length, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(float, 0);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now, nextPlayTimeRef.current);
    src.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;

    activeSourcesRef.current.push(src);
    botSpeakingRef.current = true; // silenciar el micro mientras el bot habla
    src.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== src);
      // Si ya no queda nada en cola, volvemos a "escuchando" y reabrimos el micro.
      if (activeSourcesRef.current.length === 0) {
        botSpeakingRef.current = false;
        setStatus((s) => (s === "speaking" ? "listening" : s));
      }
    };

    setStatus("speaking");
  }, []);

  // Arranca todo: WebSocket + captura de micrófono.
  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        // 1) Contexto de reproducción a 24 kHz.
        const PlayCtx = window.AudioContext || (window as any).webkitAudioContext;
        playCtxRef.current = new PlayCtx({ sampleRate: OUTPUT_SAMPLE_RATE });

        // 2) Micrófono.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;

        const MicCtx = window.AudioContext || (window as any).webkitAudioContext;
        const micCtx = new MicCtx();
        micCtxRef.current = micCtx;
        await micCtx.audioWorklet.addModule("/voice-worklet.js");

        // 3) WebSocket al backend (relay hacia Gemini Live).
        const ws = new WebSocket(VOICE_WS_URL);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        ws.onopen = () => { /* esperamos el {type:"ready"} del server */ };

        ws.onmessage = (ev) => {
          let msg: any;
          try { msg = JSON.parse(ev.data); } catch { return; }
          switch (msg.type) {
            case "ready":
              if (!cancelled) setStatus("listening");
              break;
            case "audio": {
              const bin = atob(msg.data);
              const buf = new ArrayBuffer(bin.length);
              const view = new Uint8Array(buf);
              for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
              playChunk(buf);
              break;
            }
            case "tool": {
              const label = TOOL_LABELS[msg.name] || msg.name;
              setToolLog((prev) => [...prev, label]);
              setStatus("thinking");
              break;
            }
            case "interrupted":
              stopPlayback();
              setStatus("listening");
              break;
            case "turn_complete":
              if (activeSourcesRef.current.length === 0) setStatus("listening");
              // El bot terminó de responder: arrancamos a contar la inactividad
              // del usuario desde acá.
              armInactivityTimer();
              break;
            case "bye":
              // El bot decidió finalizar la llamada (el usuario se despidió).
              // Esperamos a que termine de reproducirse su despedida y cerramos.
              {
                const finish = () => closeCall("Llamada finalizada por el asistente.");
                if (activeSourcesRef.current.length > 0) {
                  // Hay audio de despedida en cola: cerramos cuando termine.
                  const wait = setInterval(() => {
                    if (activeSourcesRef.current.length === 0) {
                      clearInterval(wait);
                      finish();
                    }
                  }, 200);
                } else {
                  finish();
                }
              }
              break;
            case "error":
              setErrorMsg(msg.message || "Error en la sesión de voz.");
              setStatus("error");
              break;
          }
        };

        ws.onerror = () => {
          if (!cancelled) {
            setErrorMsg("No se pudo conectar con el modo voz. ¿El backend está corriendo?");
            setStatus("error");
          }
        };

        ws.onclose = () => {
          if (!cancelled) setStatus((s) => (s === "error" ? s : "closed"));
        };

        // 4) Conectar el micrófono al worklet y enviar PCM por el socket.
        const source = micCtx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(micCtx, "voice-capture-processor");
        workletNodeRef.current = node;
        node.port.onmessage = (e) => {
          const pcmBuffer: ArrayBuffer = e.data;
          if (ws.readyState !== WebSocket.OPEN) return;
          // Mientras el bot habla, no enviamos el micro (evita captar su eco).
          if (botSpeakingRef.current) return;
          // El usuario está enviando audio → hay actividad: reseteamos el timer
          // de inactividad (a lo sumo una vez por segundo para no recrearlo en cada chunk).
          const now = Date.now();
          if (now - lastUserSpeechRef.current > 1000) {
            lastUserSpeechRef.current = now;
            armInactivityTimer();
          }
          // base64 del PCM16 para mandarlo como JSON.
          let bin = "";
          const view = new Uint8Array(pcmBuffer);
          for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
          ws.send(JSON.stringify({ type: "audio", data: btoa(bin) }));
        };
        source.connect(node);
        // No conectamos el node al destination (no queremos oírnos a nosotros).
      } catch (e: any) {
        if (cancelled) return;
        const name = e?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          setErrorMsg("Permiso de micrófono denegado. Habilitalo en el navegador para usar el modo voz.");
        } else if (name === "NotFoundError") {
          setErrorMsg("No se detectó ningún micrófono.");
        } else {
          setErrorMsg("No se pudo iniciar el modo voz: " + (e?.message || name || "error desconocido"));
        }
        setStatus("error");
      }
    }

    start();
    return () => { cancelled = true; cleanup(); };
  }, [cleanup, playChunk, stopPlayback, armInactivityTimer, closeCall]);

  function handleHangUp() {
    closeCall();
  }

  const statusText: Record<Status, string> = {
    connecting: "Conectando…",
    listening: "Escuchando — hablá cuando quieras",
    speaking: "El asistente está hablando…",
    thinking: "Pensando…",
    error: "Error",
    closed: "Llamada finalizada",
  };

  // Mientras el bot habla, el micro queda en pausa (no captamos su eco).
  const micMuted = status === "speaking";

  return (
    <div className={`voice-screen voice-screen-${status}`} role="dialog" aria-modal="true">
      {/* Fondo con resplandor que respira según el estado */}
      <div className="voice-bg-glow" />

      <button className="voice-close" onClick={handleHangUp} aria-label="Cerrar">
        <X size={22} />
      </button>

      {/* Aviso de micrófono en pausa — barra arriba, separada del resto */}
      {micMuted && (
        <div className="voice-mic-off">
          <MicOff size={15} /> Micrófono en pausa mientras el asistente habla
        </div>
      )}

      <div className="voice-stage">
        {/* Orbe gradiente fluido con halos y ondas reactivas */}
        <div className={`voice-orb voice-orb-${status}`}>
          <div className="voice-orb-halo voice-orb-halo-1" />
          <div className="voice-orb-halo voice-orb-halo-2" />
          <div className="voice-orb-core">
            {status === "speaking" ? (
              <div className="voice-wave">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span key={i} style={{ animationDelay: `${i * 0.12}s` }} />
                ))}
              </div>
            ) : status === "connecting" || status === "thinking" ? (
              <div className="voice-dots">
                {Array.from({ length: 3 }).map((_, i) => (
                  <span key={i} style={{ animationDelay: `${i * 0.18}s` }} />
                ))}
              </div>
            ) : status === "error" || status === "closed" ? (
              <MicOff size={44} />
            ) : (
              <Mic size={44} />
            )}
          </div>
        </div>

        {/* Zona de info de altura fija: el orbe nunca se mueve aunque cambie. */}
        <div className="voice-info">
          <p className="voice-status">{closeNote ?? statusText[status]}</p>
          {errorMsg && <p className="voice-error">{errorMsg}</p>}
        </div>
      </div>

      {/* Lista de herramientas: anclada abajo, no afecta la posición del orbe */}
      {toolLog.length > 0 && (
        <div className="voice-tools">
          <span className="voice-tools-title">Herramientas usadas</span>
          <ul className="voice-tools-list">
            {toolLog.slice(-3).map((t, i) => (
              <li key={toolLog.length - 3 + i} className="voice-tool-item">
                <Wrench size={13} /> {t}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button className="voice-hangup" onClick={handleHangUp}>
        <PhoneOff size={20} /> {status === "error" || status === "closed" ? "Cerrar" : "Cortar llamada"}
      </button>
    </div>
  );
}

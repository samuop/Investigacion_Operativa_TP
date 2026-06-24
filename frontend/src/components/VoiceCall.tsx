import { useEffect, useRef, useState, useCallback } from "react";
import { Mic, MicOff, PhoneOff, X, Wrench, Maximize2 } from "lucide-react";
import { VOICE_WS_URL } from "../api";

interface Props {
  onClose: () => void;
}

type Status = "connecting" | "listening" | "speaking" | "thinking" | "error" | "closed";

// Entrada de la transcripción/panel: habla, uso de herramienta o gráfico.
type TranscriptEntry =
  | { kind: "speech"; role: "user" | "assistant"; text: string; final: boolean }
  | { kind: "tool"; label: string }
  | { kind: "chart"; url: string };

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
  // Transcripción en vivo + gráficos (panel lateral).
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  // URL del gráfico ampliado a pantalla completa (lightbox), o null.
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Refs de audio/red — no provocan re-render.
  const wsRef = useRef<WebSocket | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  // Para auto-scroll del panel de transcripción.
  const panelEndRef = useRef<HTMLDivElement>(null);

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

  // Acumula los fragmentos de transcripción en el último turno del mismo rol,
  // o crea una entrada nueva si cambió el hablante o el turno anterior cerró.
  const addTranscript = useCallback(
    (role: "user" | "assistant", text: string, final: boolean) => {
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.kind === "speech" && last.role === role && !last.final) {
          const updated: TranscriptEntry = {
            ...last, text: last.text + text, final: last.final || final,
          };
          return [...prev.slice(0, -1), updated];
        }
        return [...prev, { kind: "speech", role, text, final }];
      });
    },
    [],
  );

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
              // Mostrar el uso de la herramienta en el hilo (estilo Claude Code).
              setTranscript((prev) => [...prev, { kind: "tool", label }]);
              setStatus("thinking");
              break;
            }
            case "transcript":
              if (msg.text) addTranscript(msg.role, msg.text, !!msg.final);
              break;
            case "chart":
              if (msg.url) setTranscript((prev) => [...prev, { kind: "chart", url: msg.url }]);
              break;
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
  }, [cleanup, playChunk, stopPlayback, armInactivityTimer, closeCall, addTranscript]);

  // Auto-scroll del panel hacia el último mensaje.
  useEffect(() => {
    panelEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript]);

  // Cerrar el lightbox del gráfico con la tecla Escape.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

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

  const hasPanel = transcript.length > 0;

  return (
    <div
      className={`voice-screen voice-screen-${status}${hasPanel ? " voice-screen-split" : ""}`}
      role="dialog"
      aria-modal="true"
    >
      <button className="voice-close" onClick={handleHangUp} aria-label="Cerrar">
        <X size={22} />
      </button>

      {/* Aviso de micrófono en pausa — barra arriba, separada del resto */}
      {micMuted && (
        <div className="voice-mic-off">
          <MicOff size={15} /> Micrófono en pausa mientras el asistente habla
        </div>
      )}

      {/* Columna izquierda: orbe + estado + botón */}
      <div className="voice-left">
        {/* Fondo con resplandor que respira según el estado */}
        <div className="voice-bg-glow" />

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

        <button className="voice-hangup" onClick={handleHangUp}>
          <PhoneOff size={20} /> {status === "error" || status === "closed" ? "Cerrar" : "Cortar llamada"}
        </button>
      </div>

      {/* Columna derecha: panel de transcripción en vivo + gráficos */}
      {hasPanel && (
        <div className="voice-panel">
          <div className="voice-panel-header">
            <span>Transcripción en vivo</span>
            {toolLog.length > 0 && (
              <span className="voice-panel-tool">
                <Wrench size={12} /> {toolLog[toolLog.length - 1]}
              </span>
            )}
          </div>
          <div className="voice-panel-body">
            {transcript.map((entry, i) => {
              if (entry.kind === "tool") {
                return (
                  <div key={i} className="voice-event">
                    <Wrench size={13} />
                    <span>{entry.label}</span>
                  </div>
                );
              }
              if (entry.kind === "chart") {
                return (
                  <button
                    key={i}
                    className="voice-bubble-chart"
                    onClick={() => setLightbox(entry.url)}
                    title="Click para ampliar"
                  >
                    <img src={entry.url} alt="Gráfico EOQ" />
                    <span className="voice-chart-zoom"><Maximize2 size={15} /> Ampliar</span>
                  </button>
                );
              }
              return (
                <div key={i} className={`voice-bubble voice-bubble-${entry.role}`}>
                  <span className="voice-bubble-who">
                    {entry.role === "user" ? "Vos" : "Asistente"}
                  </span>
                  <p>{entry.text}</p>
                </div>
              );
            })}
            <div ref={panelEndRef} />
          </div>
        </div>
      )}

      {/* Lightbox: gráfico ampliado a pantalla completa */}
      {lightbox && (
        <div className="voice-lightbox" onClick={() => setLightbox(null)}>
          <button className="voice-lightbox-close" aria-label="Cerrar">
            <X size={26} />
          </button>
          <img src={lightbox} alt="Gráfico EOQ ampliado" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, MessageOut } from "../api";

interface Props {
  sessionId: string | null;
  onSessionCreated: (id: string) => void;
  onSessionUpdate?: () => void;
}

const ERROR_INFO: Record<string, { icon: string; title: string; body: string; hint?: string }> = {
  quota: {
    icon: "⏳",
    title: "Límite de cuota alcanzado",
    body: "Tu API key gratuita agotó el límite de consultas del día.",
    hint: "Las cuotas se reestablecen automáticamente a la medianoche (hora del Pacífico). Podés cambiar el modelo o usar otra API key desde Configuración.",
  },
  unavailable: {
    icon: "🌐",
    title: "Modelo temporalmente no disponible",
    body: "El modelo está experimentando alta demanda en este momento.",
    hint: "Esperá unos segundos e intentá de nuevo. Si el problema persiste, probá con otro modelo desde Configuración.",
  },
  invalid_key: {
    icon: "🔑",
    title: "API key inválida",
    body: "La API key configurada no es válida o fue revocada.",
    hint: "Ingresá a Configuración y actualizá tu API key desde aistudio.google.com.",
  },
  no_key: {
    icon: "🔑",
    title: "Sin API key configurada",
    body: "Todavía no configuraste una API key de Google AI Studio.",
    hint: "Abrí Configuración (abajo a la izquierda) e ingresá tu API key gratuita.",
  },
  backend: {
    icon: "🔌",
    title: "Sin conexión al backend",
    body: "No se pudo conectar con el servidor.",
    hint: "Verificá que el backend esté corriendo: uvicorn backend.main:app --reload",
  },
  unknown: {
    icon: "⚠",
    title: "Error inesperado",
    body: "Ocurrió un error al procesar tu consulta.",
    hint: "Intentá de nuevo. Si persiste, revisá los logs del backend.",
  },
};

function ChatError({ type }: { type?: string }) {
  const info = ERROR_INFO[type ?? "unknown"] ?? ERROR_INFO.unknown;
  return (
    <div className="chat-error-card">
      <div className="chat-error-icon">{info.icon}</div>
      <div className="chat-error-body">
        <strong>{info.title}</strong>
        <p>{info.body}</p>
        {info.hint && <p className="chat-error-hint">{info.hint}</p>}
      </div>
    </div>
  );
}

// Captura cualquier URL de QuickChart (/chart?..., /chart/render/..., etc.)
const QUICKCHART_RE = /https:\/\/quickchart\.io\/chart\/?[^\s\)\"\'\]]*/;

function extractChartUrl(text: string): string | null {
  const match = text.match(QUICKCHART_RE);
  return match ? match[0] : null;
}

// Limpia el texto: quita la URL del gráfico y la sintaxis markdown de imagen ![...](...)
function cleanText(content: string, chartUrl: string | null): string {
  let t = content;
  if (chartUrl) {
    // Quitar imagen markdown que apunte a quickchart: ![alt](url)
    t = t.replace(/!\[[^\]]*\]\(\s*https:\/\/quickchart\.io[^\)]*\)/g, "");
    // Quitar link markdown a quickchart: [texto](url)
    t = t.replace(/\[[^\]]*\]\(\s*https:\/\/quickchart\.io[^\)]*\)/g, "");
    // Quitar la URL pelada
    t = t.replace(chartUrl, "");
  }
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

function ChartImage({ url }: { url: string }) {
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = "grafico_eoq.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      // Fallback: abrir en nueva pestaña
      window.open(url, "_blank");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="chart-container">
      {!loaded && !err && <div className="chart-loading">Cargando gráfico...</div>}
      {err && <div className="chart-error-msg">No se pudo cargar el gráfico.</div>}
      <img
        src={url}
        alt="Gráfico EOQ"
        className={`chart-img ${loaded ? "visible" : "hidden"}`}
        onLoad={() => setLoaded(true)}
        onError={() => setErr(true)}
      />
      {loaded && (
        <button className="btn-download" onClick={handleDownload} disabled={downloading}>
          {downloading ? "Descargando..." : "↓ Descargar gráfico"}
        </button>
      )}
    </div>
  );
}

function AssistantMessage({ content, showCursor }: { content: string; showCursor?: boolean }) {
  const chartUrl = extractChartUrl(content);
  const text = cleanText(content, chartUrl);

  // Mientras el cursor está activo (typewriter en curso), no mostrar el gráfico
  // todavía — así no queda el gráfico arriba del texto que se sigue escribiendo.
  const showChart = chartUrl && !showCursor;

  return (
    <div className={`message-bubble${showCursor ? " with-cursor" : ""}`}>
      {text
        ? <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Nunca renderizar imágenes markdown (evita íconos rotos);
              // los gráficos se manejan con ChartImage aparte
              img: () => null,
            }}
          >{text}</ReactMarkdown>
        : showCursor && <span>&nbsp;</span>
      }
      {showChart && <ChartImage url={chartUrl} />}
    </div>
  );
}

export default function Chat({ sessionId, onSessionCreated, onSessionUpdate }: Props) {
  const [messages, setMessages] = useState<MessageOut[]>([]);
  const [typing, setTyping] = useState<string | null>(null); // texto en typewriter
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<{ msg: string; type?: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typewriterRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSending = useRef(false);

  useEffect(() => {
    setError(null);
    setTyping(null);

    if (!sessionId) {
      setMessages([]);
      return;
    }

    // Si estamos en medio de un envío (la sesión se acaba de crear al enviar),
    // no limpiar los mensajes locales — ya tienen el mensaje del usuario
    if (isSending.current) return;

    setMessages([]);
    api.getMessages(sessionId).then(setMessages).catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing, loading]);

  // Typewriter: muestra el texto completo letra a letra
  const runTypewriter = useCallback((fullText: string, onComplete: () => void) => {
    let i = 0;
    setTyping("");

    function tick() {
      i++;
      setTyping(fullText.slice(0, i));
      if (i < fullText.length) {
        // Velocidad adaptativa: más rápido para textos largos
        const delay = fullText.length > 300 ? 8 : 18;
        typewriterRef.current = setTimeout(tick, delay);
      } else {
        onComplete();
      }
    }
    tick();
  }, []);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    // Crear sesión automáticamente si no hay una activa
    let sid = sessionId;
    if (!sid) {
      try {
        const s = await api.createSession();
        sid = s.id;
        onSessionCreated(s.id);
      } catch {
        setError({ msg: "No se pudo crear la sesión. Verificá que el backend esté corriendo.", type: "backend" });
        return;
      }
    }

    isSending.current = true;
    const userMsg: MessageOut = { role: "user", content: text, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setError(null);
    setTyping(null);

    requestAnimationFrame(() => inputRef.current?.focus());

    await api.chatStream(
      sid,
      text,
      (fullReply) => {
        setLoading(false);
        runTypewriter(fullReply, () => {
          // Typewriter terminó — fijar como mensaje definitivo
          setTyping(null);
          isSending.current = false;
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: fullReply, created_at: new Date().toISOString() },
          ]);
          onSessionUpdate?.();
          requestAnimationFrame(() => inputRef.current?.focus());
        });
      },
      (errMsg, errType) => {
        isSending.current = false;
        setError({ msg: errMsg, type: errType });
        setTyping(null);
        setLoading(false);
      },
    );
  }

  return (
    <div className="chat">
      <div className="chat-messages">

        {/* Sin sesión y sin mensajes — pantalla de bienvenida */}
        {!sessionId && messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">📦</div>
            <h2>Chatbot EOQ</h2>
            <p>Escribí tu consulta y se creará la conversación automáticamente.</p>
          </div>
        )}

        {/* Sesión abierta sin mensajes */}
        {sessionId && messages.length === 0 && !loading && !typing && (
          <div className="chat-welcome">
            <p>¡Hola! Soy tu asistente EOQ. Podés:</p>
            <ul>
              <li>Calcular q0 — <em>"D=1200, K=4000, c1=800"</em></li>
              <li>Consultar conceptos — <em>"¿Qué es el CTE?"</em></li>
              <li>Practicar — <em>"Dame un ejercicio"</em></li>
              <li>Ver el gráfico — <em>"Generá el gráfico de costos"</em></li>
            </ul>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            {m.role === "assistant"
              ? <AssistantMessage content={m.content} />
              : <div className="message-bubble"><p>{m.content}</p></div>}
          </div>
        ))}

        {/* Cursor parpadeante mientras espera o escribe */}
        {(loading || typing !== null) && (
          <div className="message assistant">
            <AssistantMessage content={typing ?? ""} showCursor />
          </div>
        )}

        {error && <ChatError type={error.type} />}
        <div ref={bottomRef} />
      </div>

      <form className="chat-input-row" onSubmit={handleSend}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Escribí tu consulta..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={loading || !input.trim()}>
          {loading ? "..." : "Enviar"}
        </button>
      </form>
    </div>
  );
}

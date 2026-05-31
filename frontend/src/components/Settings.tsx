import { useState, useEffect, useRef } from "react";
import { api, ConfigOut } from "../api";

interface Props {
  onClose: () => void;
}

// Orden de preferencia para el modelo por defecto al configurar una key nueva.
// Se elige el primero que esté disponible en la cuenta del usuario.
const PREFERRED_MODELS = [
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];

function pickDefaultModel(available: string[]): string {
  const preferred = PREFERRED_MODELS.find((m) => available.includes(m));
  return preferred ?? available[0];
}

export default function Settings({ onClose }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [config, setConfig] = useState<ConfigOut | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [backendDown, setBackendDown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.getConfig()
      .then((c) => setConfig(c))
      .catch((e: any) => { if (e?.type === "backend") setBackendDown(true); });

    // Si hay config guardada, pre-llenar key y cargar modelos disponibles
    api.getConfigFull().then(async (full) => {
      setApiKey(full.api_key);
      setFetchingModels(true);
      try {
        const res = await api.getModels(full.api_key);
        if (res.models.length > 0) {
          setModels(res.models);
          // Respetar el modelo guardado si sigue disponible, sino usar el preferido
          setModel(res.models.includes(full.model) ? full.model : pickDefaultModel(res.models));
        }
      } catch {
        setModels([]);
      } finally {
        setFetchingModels(false);
      }
    }).catch((e: any) => {
      // 404 = sin config previa (normal). backend = servidor caído.
      if (e?.type === "backend") setBackendDown(true);
    });
  }, []);

  function handleKeyChange(val: string) {
    setApiKey(val);
    setModelsError("");
    setMsg(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = val.trim();
    if (trimmed.length < 20) {
      setModels([]);
      setModel("");
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setFetchingModels(true);
      try {
        const res = await api.getModels(trimmed);
        if (res.models.length > 0) {
          setModels(res.models);
          setModel((prev) => res.models.includes(prev) ? prev : pickDefaultModel(res.models));
        }
      } catch (e: any) {
        setModelsError(e.message ?? "No se pudieron cargar los modelos.");
        setModels([]);
        setModel("");
      } finally {
        setFetchingModels(false);
      }
    }, 700);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) {
      setMsg({ text: "Ingresá tu API key.", ok: false });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await api.saveConfig(apiKey.trim(), model);
      setMsg({ text: "Configuración guardada correctamente.", ok: true });
      setConfig({ model, has_api_key: true });
    } catch (err: any) {
      const text = err?.type === "backend"
        ? "No se pudo conectar con el servidor. ¿Está corriendo el backend?"
        : `Error: ${err.message}`;
      setMsg({ text, ok: false });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("¿Eliminar la API key configurada? El chatbot dejará de funcionar hasta que ingreses una nueva.")) return;
    setDeleting(true);
    try {
      await api.deleteConfig();
      setConfig({ model: "", has_api_key: false });
      setApiKey("");
      setModels([]);
      setModel("");
      setMsg({ text: "API key eliminada.", ok: true });
    } catch {
      setMsg({ text: "No se pudo eliminar la configuración.", ok: false });
    } finally {
      setDeleting(false);
    }
  }

  const canSave = !saving && !fetchingModels && models.length > 0 && apiKey.trim().length > 0;

  return (
    <div className="settings-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-panel">

        {/* Header */}
        <div className="settings-header">
          <div className="settings-title">
            <span className="settings-icon">⚙</span>
            <h2>Configuración</h2>
          </div>
          <button className="btn-close" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        {/* Backend caído — bloquea todo lo demás */}
        {backendDown && (
          <div className="settings-status warn">
            <span>🔌 No se pudo conectar con el servidor. Verificá que el backend esté corriendo (terminal con <code>npm run dev</code>) y reabrí esta ventana.</span>
          </div>
        )}

        {/* Estado actual */}
        {config?.has_api_key ? (
          <div className="settings-status ok">
            <div className="status-left">
              <span className="status-dot" />
              API key activa · <strong>{config.model}</strong>
            </div>
            <button type="button" className="btn-delete-key" onClick={handleDelete} disabled={deleting}>
              {deleting ? "..." : "Eliminar"}
            </button>
          </div>
        ) : (
          <div className="settings-status warn">
            <span>⚠ Sin API key — el chatbot no funcionará hasta que configures una.</span>
          </div>
        )}

        <form onSubmit={handleSave}>

          {/* API Key */}
          <div className="field">
            <label htmlFor="apikey">Google API Key</label>
            <div className="input-wrapper">
              <input
                id="apikey"
                type={showKey ? "text" : "password"}
                placeholder="key"
                value={apiKey}
                onChange={(e) => handleKeyChange(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn-eye"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "Ocultar clave" : "Mostrar clave"}
              >
                {showKey ? "🙈" : "👁"}
              </button>
            </div>
            <span className="field-hint">
              Obtené tu key gratis en{" "}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                aistudio.google.com
              </a>
            </span>
          </div>

          {/* Modelo */}
          <div className="field">
            <label>Modelo</label>
            {fetchingModels ? (
              <div className="models-loading">
                <span className="spinner" /> Buscando modelos...
              </div>
            ) : models.length > 0 ? (
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <div className={`models-placeholder ${modelsError ? "error" : ""}`}>
                {modelsError || "Ingresá tu API key para ver los modelos disponibles."}
              </div>
            )}
          </div>

          <button className="btn-save" type="submit" disabled={!canSave}>
            {saving ? "Guardando..." : "Guardar configuración"}
          </button>
        </form>

        {msg && (
          <div className={`settings-msg ${msg.ok ? "ok" : "error"}`}>
            {msg.ok ? "✓ " : "✗ "}{msg.text}
          </div>
        )}
      </div>
    </div>
  );
}

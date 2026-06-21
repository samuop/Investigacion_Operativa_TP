import { useState, useRef, useEffect } from "react";
import { SessionOut, api } from "../api";

interface Props {
  sessions: SessionOut[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onHelp: () => void;
  onSettings: () => void;
  onVoice: () => void;
  onDeleted: (id: string) => void;
  onRenamed: (id: string, title: string) => void;
}

interface MenuState {
  sessionId: string;
  x: number;
  y: number;
}

export default function Sidebar({ sessions, activeId, onSelect, onNew, onHelp, onSettings, onVoice, onDeleted, onRenamed }: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  // Cerrar menú al hacer click fuera
  useEffect(() => {
    if (!menu) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menu]);

  // Foco en el input de edición
  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  function openMenu(e: React.MouseEvent, sessionId: string) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ sessionId, x: rect.right, y: rect.bottom });
  }

  function startRename(s: SessionOut) {
    setMenu(null);
    setEditingId(s.id);
    setEditValue(s.title);
  }

  async function commitRename(id: string) {
    const title = editValue.trim();
    setEditingId(null);
    if (!title) return;
    try {
      await api.renameSession(id, title);
      onRenamed(id, title);
    } catch {}
  }

  async function handleDelete(id: string) {
    setMenu(null);
    try {
      await api.deleteSession(id);
      onDeleted(id);
    } catch {}
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-logo">EOQ</span>
        <span className="sidebar-subtitle">Modelo de Wilson</span>
      </div>

      <button className="btn-new" onClick={onNew}>
        + Nueva conversación
      </button>

      <button className="btn-voice" onClick={onVoice}>
        <span className="btn-voice-icon">🎙️</span>
        <span>Hablar con el bot</span>
      </button>

      <button className="btn-help" onClick={onHelp}>
        <span className="btn-help-icon">❓</span>
        <span className="btn-help-text">Guía de ayuda</span>
      </button>

      <div className="sessions-list">
        {sessions.length === 0 && (
          <p className="sessions-empty">Sin conversaciones aún</p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`session-item ${s.id === activeId ? "active" : ""}`}
            onClick={() => editingId !== s.id && onSelect(s.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && editingId !== s.id && onSelect(s.id)}
          >
            <div className="session-body">
              {editingId === s.id ? (
                <input
                  ref={editRef}
                  className="session-edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => commitRename(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(s.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="session-title">{s.title}</span>
                  <span className="session-date">
                    {new Date(s.created_at).toLocaleDateString("es-AR", {
                      day: "2-digit",
                      month: "short",
                    })}
                  </span>
                </>
              )}
            </div>

            {editingId !== s.id && (
              <button
                className="btn-session-menu"
                onClick={(e) => openMenu(e, s.id)}
                aria-label="Opciones"
              >
                ···
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Menú contextual */}
      {menu && (
        <div
          ref={menuRef}
          className="session-context-menu"
          style={{ top: menu.y, left: Math.min(menu.x, window.innerWidth - 160) }}
        >
          <button onClick={() => {
            const s = sessions.find((s) => s.id === menu.sessionId);
            if (s) startRename(s);
          }}>
            ✎ Renombrar
          </button>
          <button className="danger" onClick={() => handleDelete(menu.sessionId)}>
            🗑 Eliminar
          </button>
        </div>
      )}

      <button className="btn-settings" onClick={onSettings}>
        ⚙ Configuración
      </button>
    </aside>
  );
}

import { useState, useEffect, useCallback } from "react";
import { api, SessionOut } from "./api";
import Sidebar from "./components/Sidebar";
import Chat from "./components/Chat";
import HelpModal from "./components/HelpModal";
import Settings from "./components/Settings";
import VoiceCall from "./components/VoiceCall";
import "./App.css";

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [sessions, setSessions] = useState<SessionOut[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [backendDown, setBackendDown] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const list = await api.getSessions();
      setSessions(list);
      setBackendDown(false);
    } catch (e: any) {
      if (e?.type === "backend") setBackendDown(true);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  async function handleNew() {
    try {
      const s = await api.createSession();
      setSessions((prev) => [s, ...prev]);
      setActiveId(s.id);
      setBackendDown(false);
    } catch (e: any) {
      if (e?.type === "backend") setBackendDown(true);
    }
  }

  function handleSelect(id: string) {
    setActiveId(id);
  }

  function handleDeleted(id: string) {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeId === id) setActiveId(null);
  }

  function handleRenamed(id: string, title: string) {
    setSessions((prev) => prev.map((s) => s.id === id ? { ...s, title } : s));
  }

  return (
    <div className="app">
      {backendDown && (
        <div className="backend-banner">
          🔌 Sin conexión con el servidor — verificá que el backend esté corriendo (<code>npm run dev</code>).
          <button onClick={loadSessions}>Reintentar</button>
        </div>
      )}
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={handleSelect}
        onNew={handleNew}
        onHelp={() => setShowHelp(true)}
        onSettings={() => setShowSettings(true)}
        onVoice={() => setShowVoice(true)}
        onDeleted={handleDeleted}
        onRenamed={handleRenamed}
      />
      <main className="main">
        <Chat
          sessionId={activeId}
          onSessionCreated={(id) => { setActiveId(id); loadSessions(); }}
          onSessionUpdate={loadSessions}
        />
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
        {showSettings && <Settings onClose={() => setShowSettings(false)} />}
        {showVoice && <VoiceCall onClose={() => setShowVoice(false)} />}
      </main>
    </div>
  );
}

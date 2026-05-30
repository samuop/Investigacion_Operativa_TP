import { useState, useEffect, useCallback } from "react";
import { api, SessionOut } from "./api";
import Sidebar from "./components/Sidebar";
import Chat from "./components/Chat";
import Settings from "./components/Settings";
import "./App.css";

export default function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [sessions, setSessions] = useState<SessionOut[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    const list = await api.getSessions().catch(() => []);
    setSessions(list);
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  async function handleNew() {
    const s = await api.createSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
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
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={handleSelect}
        onNew={handleNew}
        onSettings={() => setShowSettings(true)}
        onDeleted={handleDeleted}
        onRenamed={handleRenamed}
      />
      <main className="main">
        <Chat
          sessionId={activeId}
          onSessionCreated={(id) => { setActiveId(id); loadSessions(); }}
          onSessionUpdate={loadSessions}
        />
        {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      </main>
    </div>
  );
}

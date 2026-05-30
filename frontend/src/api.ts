const BASE = "http://localhost:8000";

export interface ConfigOut {
  model: string;
  has_api_key: boolean;
}

export interface SessionOut {
  id: string;
  title: string;
  created_at: string;
}

export interface MessageOut {
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ChatOut {
  reply: string;
  session_id: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Error desconocido");
  }
  return res.json();
}

export const api = {
  getConfig: () => request<ConfigOut>("/config"),

  getConfigFull: () => request<{ api_key: string; model: string }>("/config/full"),

  deleteConfig: () => request<{ ok: boolean }>("/config", { method: "DELETE" }),

  saveConfig: (api_key: string, model: string) =>
    request<ConfigOut>("/config", {
      method: "POST",
      body: JSON.stringify({ api_key, model }),
    }),

  getModels: (api_key: string) =>
    request<{ models: string[] }>(`/models?api_key=${encodeURIComponent(api_key)}`),

  getSessions: () => request<SessionOut[]>("/sessions"),

  createSession: () =>
    request<SessionOut>("/sessions", { method: "POST" }),

  getMessages: (sessionId: string) =>
    request<MessageOut[]>(`/sessions/${sessionId}/messages`),

  renameSession: (sessionId: string, title: string) =>
    request<SessionOut>(`/sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),

  deleteSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/sessions/${sessionId}`, { method: "DELETE" }),

  chat: (session_id: string, message: string) =>
    request<ChatOut>("/chat", {
      method: "POST",
      body: JSON.stringify({ session_id, message }),
    }),

  chatStream: async (
    session_id: string,
    message: string,
    onReply: (full: string) => void,
    onError: (msg: string, type?: string) => void,
  ) => {
    const res = await fetch(`${BASE}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id, message }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      const detail = err.detail ?? "";
      const type = detail.includes("API key") || res.status === 400 ? "no_key" : "backend";
      onError(detail, type);
      return;
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.reply !== undefined) onReply(data.reply);
          if (data.error !== undefined) onError(data.raw ?? "", data.error);
        } catch {}
      }
    }
  },
};

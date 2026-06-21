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
  duration_ms?: number | null;
}

export interface ChatOut {
  reply: string;
  session_id: string;
}

/** Error con un `type` para que la UI muestre el mensaje amigable correcto. */
export class ApiError extends Error {
  type: string;
  constructor(message: string, type = "unknown") {
    super(message);
    this.type = type;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    // fetch lanza TypeError cuando no puede conectar → backend caído
    throw new ApiError(
      "No se pudo conectar con el servidor. Verificá que el backend esté corriendo.",
      "backend",
    );
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = err.detail ?? "Error desconocido";
    // Inferir el tipo a partir del status / mensaje
    let type = "unknown";
    if (res.status === 400 && /api key/i.test(detail)) type = "no_key";
    else if (res.status >= 500) type = "backend";
    throw new ApiError(detail, type);
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
    request<{ models: string[] }>("/models", {
      method: "POST",
      body: JSON.stringify({ api_key }),
    }),

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
    onReply: (full: string, durationMs?: number) => void,
    onError: (msg: string, type?: string) => void,
  ) => {
    let res: Response;
    try {
      res = await fetch(`${BASE}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id, message }),
      });
    } catch {
      onError("No se pudo conectar con el servidor.", "backend");
      return;
    }

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
          if (data.reply !== undefined) onReply(data.reply, data.duration_ms);
          if (data.error !== undefined) onError(data.raw ?? "", data.error);
        } catch {}
      }
    }
  },
};

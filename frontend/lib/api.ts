"use client";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("mata_access");
}

function setTokens(access: string, refresh: string) {
  localStorage.setItem("mata_access", access);
  localStorage.setItem("mata_refresh", refresh);
}

export function logout() {
  localStorage.removeItem("mata_access");
  localStorage.removeItem("mata_refresh");
}

// Exchange the refresh token for a fresh access token. Returns true on success.
export async function refreshTokens(): Promise<boolean> {
  const rt = typeof window !== "undefined" ? localStorage.getItem("mata_refresh") : null;
  if (!rt) return false;
  const res = await fetch(`${API}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: rt }),
  });
  if (!res.ok) {
    logout();
    return false;
  }
  const tokens = await res.json();
  setTokens(tokens.access_token, tokens.refresh_token);
  return true;
}

function doFetch(path: string, opts: RequestInit, auth: boolean) {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers as any) };
  const token = getToken();
  if (auth && token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${API}${path}`, { ...opts, headers });
}

async function request(path: string, opts: RequestInit = {}, auth = true) {
  let res = await doFetch(path, opts, auth);
  // Access token expired → refresh once and retry transparently.
  if (res.status === 401 && auth && (await refreshTokens())) {
    res = await doFetch(path, opts, auth);
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  // auth
  register: (body: any) => request("/auth/register", { method: "POST", body: JSON.stringify(body) }, false).then(saveAuth),
  login: (body: any) => request("/auth/login", { method: "POST", body: JSON.stringify(body) }, false).then(saveAuth),
  me: () => request("/auth/me"),
  // non-streaming chat (used by the voice avatar)
  chat: (messages: any[]) =>
    request("/chat/completions", { method: "POST", body: JSON.stringify({ messages, stream: false }) }),
  // modules
  image: (body: any) => request("/image/generations", { method: "POST", body: JSON.stringify(body) }),
  code: (body: any) => request("/code/generations", { method: "POST", body: JSON.stringify(body) }),
  videoSubmit: (body: any) => request("/video/jobs", { method: "POST", body: JSON.stringify(body) }),
  videoPoll: (id: string) => request(`/video/jobs/${id}`),
  musicSubmit: (body: any) => request("/music/jobs", { method: "POST", body: JSON.stringify(body) }),
  musicPoll: (id: string) => request(`/music/jobs/${id}`),
  agentRun: (body: any) => request("/agent/runs", { method: "POST", body: JSON.stringify(body) }),
  // billing
  tiers: () => request("/billing/tiers", {}, false),
  checkout: (tier: string) => request("/billing/checkout", { method: "POST", body: JSON.stringify({ tier }) }),
  // admin
  adminOverview: () => request("/admin/overview"),
  adminUsers: () => request("/admin/users"),
};

function saveAuth(tokens: any) {
  setTokens(tokens.access_token, tokens.refresh_token);
  return tokens;
}

// Streaming chat (SSE over fetch).
export async function streamChat(
  messages: { role: string; content: string }[],
  conversationId: string | null,
  onDelta: (text: string) => void,
): Promise<string | null> {
  const send = () =>
    fetch(`${API}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ messages, conversation_id: conversationId, stream: true }),
    });
  let res = await send();
  // Access token expired → refresh once and retry.
  if (res.status === 401 && (await refreshTokens())) {
    res = await send();
  }
  if (!res.ok || !res.body) throw new Error(`Chat failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let convId: string | null = conversationId;
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const line = part.replace(/^data: /, "").trim();
      if (!line) continue;
      const data = JSON.parse(line);
      if (data.delta) onDelta(data.delta);
      if (data.conversation_id) convId = data.conversation_id;
      if (data.error) throw new Error(data.error);
    }
  }
  return convId;
}

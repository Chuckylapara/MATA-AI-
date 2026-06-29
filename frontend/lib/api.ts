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

// Multipart upload (FormData). Lets the browser set the Content-Type boundary;
// shares the same auth + one-shot refresh behaviour as request().
async function requestForm(path: string, form: FormData) {
  const send = () => {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(`${API}${path}`, { method: "POST", body: form, headers });
  };
  let res = await send();
  if (res.status === 401 && (await refreshTokens())) res = await send();
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  // auth
  register: (body: any) => request("/auth/register", { method: "POST", body: JSON.stringify(body) }, false).then(saveAuth),
  login: (body: any) => request("/auth/login", { method: "POST", body: JSON.stringify(body) }, false).then(saveAuth),
  me: () => request("/auth/me"),
  // non-streaming chat (used by the voice avatar)
  chat: (messages: any[]) =>
    request("/chat/completions", { method: "POST", body: JSON.stringify({ messages, stream: false }) }),
  // chat memory (per-user, server-side)
  listConversations: () => request("/chat/conversations"),
  getConversation: (id: string) => request(`/chat/conversations/${id}`),
  // modules
  image: (body: any) => request("/image/generations", { method: "POST", body: JSON.stringify(body) }),
  code: (body: any) => request("/code/generations", { method: "POST", body: JSON.stringify(body) }),
  videoSubmit: (body: any) => request("/video/jobs", { method: "POST", body: JSON.stringify(body) }),
  videoPoll: (id: string) => request(`/video/jobs/${id}`),
  musicSubmit: (body: any) => request("/music/jobs", { method: "POST", body: JSON.stringify(body) }),
  musicPoll: (id: string) => request(`/music/jobs/${id}`),
  agentRun: (body: any) => request("/agent/runs", { method: "POST", body: JSON.stringify(body) }),
  // Viral AI Studio (idea -> analysis -> storyboard -> per-scene images)
  studioAnalyze: (idea: string) =>
    request("/studio/analyze", { method: "POST", body: JSON.stringify({ idea }) }),
  studioStoryboard: (body: { idea: string; analysis?: any; target_seconds: number; aspect_ratio: string }) =>
    request("/studio/storyboard", { method: "POST", body: JSON.stringify(body) }),
  studioSceneImages: (body: { prompt: string; n: number; aspect_ratio: string; style?: string }) =>
    request("/studio/scene-images", { method: "POST", body: JSON.stringify(body) }),
  studioVoiceover: (body: { text: string; voice?: string; language?: string }) =>
    request("/studio/voiceover", { method: "POST", body: JSON.stringify(body) }),
  studioSubtitles: (body: { escenas: any[]; fmt: string; language?: string | null }) =>
    request("/studio/subtitles", { method: "POST", body: JSON.stringify(body) }),
  studioRender: (body: {
    escenas: any[];
    aspect_ratio: string;
    resolution: string;
    voice?: string;
    language?: string;
    burn_subtitles?: boolean;
    animate?: boolean;
    background_music?: boolean;
    title?: string;
  }) => request("/studio/render", { method: "POST", body: JSON.stringify(body) }),
  studioThumbnail: (body: { title: string; style?: string; aspect_ratio?: string }) =>
    request("/studio/thumbnail", { method: "POST", body: JSON.stringify(body) }),
  studioVideos: () => request("/studio/videos"),
  studioVideoStatus: (id: string) => request(`/studio/videos/${id}`),
  // Clips (long video -> short vertical clips). Submit is multipart (url OR file).
  clipsSubmit: (form: FormData) => requestForm("/clips/jobs", form),
  clipsPoll: (id: string) => request(`/clips/jobs/${id}`),
  clipsList: () => request("/clips/jobs"),
  apiBase: API,
  // billing
  tiers: () => request("/billing/tiers", {}, false),
  checkout: (tier: string) => request("/billing/checkout", { method: "POST", body: JSON.stringify({ tier }) }),
  // billing — PayPal (subscriptions + one-time credit packs)
  creditPacks: () => request("/billing/credit-packs", {}, false),
  paypalSubscribe: (tier: string) => request("/billing/paypal/subscribe", { method: "POST", body: JSON.stringify({ tier }) }),
  paypalOrder: (pack: string) => request("/billing/paypal/order", { method: "POST", body: JSON.stringify({ pack }) }),
  paypalCapture: (order_id: string) => request("/billing/paypal/capture", { method: "POST", body: JSON.stringify({ order_id }) }),
  paypalSyncSubscription: (order_id: string) => request("/billing/paypal/sync-subscription", { method: "POST", body: JSON.stringify({ order_id }) }),
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
  signal?: AbortSignal,
): Promise<string | null> {
  const buildHeaders = () => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const t = getToken();
    if (t) h["Authorization"] = `Bearer ${t}`;
    return h;
  };
  const send = () =>
    fetch(`${API}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ messages, conversation_id: conversationId, stream: true }),
      signal,
    });
  let res = await send();
  // Access token expired → refresh once and retry.
  if (res.status === 401 && getToken() && (await refreshTokens())) {
    res = await send();
  }
  if (!res.ok || !res.body) {
    if (res.status === 401) throw new Error("GUEST_LIMIT");
    throw new Error(`Chat failed: ${res.status}`);
  }
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

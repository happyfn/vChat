const API_BASE = import.meta.env.VITE_API_URL || '';

export type User = { id: number; username: string };
export type Guild = {
  id: number;
  name: string;
  owner_id: number;
  invite_code: string;
  created_at: string;
};
export type Channel = {
  id: number;
  guild_id: number;
  name: string;
  type: 'text' | 'voice';
  position: number;
};
export type Member = { id: number; username: string };
export type Message = {
  id: number;
  channel_id: number;
  user_id: number;
  username: string;
  content: string;
  created_at: string;
};

function authHeaders(token?: string | null): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...authHeaders(token),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  register(username: string, password: string) {
    return request<{ token: string; user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },
  login(username: string, password: string) {
    return request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },
  me(token: string) {
    return request<{ user: User }>('/api/auth/me', {}, token);
  },
  listGuilds(token: string) {
    return request<{ guilds: Guild[] }>('/api/guilds', {}, token);
  },
  createGuild(token: string, name: string) {
    return request<{ guild: Guild; channels: Channel[] }>(
      '/api/guilds',
      { method: 'POST', body: JSON.stringify({ name }) },
      token,
    );
  },
  joinGuild(token: string, code: string) {
    return request<{ guild: Guild; channels: Channel[] }>(
      '/api/guilds/join',
      { method: 'POST', body: JSON.stringify({ code }) },
      token,
    );
  },
  getGuild(token: string, guildId: number) {
    return request<{ guild: Guild; channels: Channel[]; members: Member[] }>(
      `/api/guilds/${guildId}`,
      {},
      token,
    );
  },
  getMessages(token: string, channelId: number) {
    return request<{ messages: Message[] }>(`/api/channels/${channelId}/messages`, {}, token);
  },
};

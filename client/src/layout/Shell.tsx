import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  api,
  type Channel,
  type Guild,
  type Member,
  type Message,
  type User,
} from '../api';
import { PromptModal } from '../components/Modal';
import { disconnectSocket, emitAck, getSocket } from '../socket';
import {
  consumeProducer,
  getActiveVoiceChannelId,
  isMuted,
  setMuted,
  startVoice,
  stopVoice,
} from '../voiceSession';

type Props = {
  token: string;
  user: User;
  onLogout: () => void;
};

type PresenceMember = {
  userId: number;
  username: string;
  guildId: number | null;
  voiceChannelId: number | null;
};

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

export function Shell({ token, user, onLogout }: Props) {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [guildId, setGuildId] = useState<number | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [channelId, setChannelId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [presence, setPresence] = useState<PresenceMember[]>([]);
  const [voicePeers, setVoicePeers] = useState<{ userId: number; username: string }[]>([]);
  const [inVoice, setInVoice] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [modal, setModal] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const channelIdRef = useRef<number | null>(null);
  const guildIdRef = useRef<number | null>(null);
  channelIdRef.current = channelId;
  guildIdRef.current = guildId;

  const activeGuild = useMemo(
    () => guilds.find((g) => g.id === guildId) || null,
    [guilds, guildId],
  );
  const activeChannel = useMemo(
    () => channels.find((c) => c.id === channelId) || null,
    [channels, channelId],
  );

  const refreshGuilds = useCallback(async () => {
    const res = await api.listGuilds(token);
    setGuilds(res.guilds);
    return res.guilds;
  }, [token]);

  const loadGuild = useCallback(
    async (id: number) => {
      const res = await api.getGuild(token, id);
      setGuildId(id);
      setChannels(res.channels);
      setMembers(res.members);
      const firstText = res.channels.find((c) => c.type === 'text') || res.channels[0] || null;
      setChannelId(firstText?.id ?? null);
      const socket = socketRef.current;
      if (socket) {
        await emitAck(socket, 'guild:join', { guildId: id });
      }
    },
    [token],
  );

  useEffect(() => {
    const socket = getSocket(token);
    socketRef.current = socket;

    socket.on('presence:update', (payload: { members: PresenceMember[] }) => {
      setPresence(payload.members || []);
    });
    socket.on('message:new', (payload: { message: Message }) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === payload.message.id)) return prev;
        if (payload.message.channel_id !== channelIdRef.current) return prev;
        return [...prev, payload.message];
      });
    });
    socket.on('voice:peers', (payload: { peers: { userId: number; username: string }[] }) => {
      setVoicePeers(payload.peers || []);
    });
    socket.on('voice:newProducer', async (payload: { userId: number; producerId: string }) => {
      if (payload.userId === user.id) return;
      try {
        await consumeProducer(socket, payload.producerId);
      } catch (err) {
        console.error('consume new producer failed', err);
      }
    });
    socket.on('voice:peerLeft', (payload: { userId: number }) => {
      setVoicePeers((prev) => prev.filter((p) => p.userId !== payload.userId));
    });
    socket.on('guild:refresh', async (payload: { guildId: number }) => {
      if (payload.guildId !== guildIdRef.current) return;
      try {
        const res = await api.getGuild(token, payload.guildId);
        setMembers(res.members);
        setChannels(res.channels);
      } catch (err) {
        console.error('guild refresh failed', err);
      }
    });

    (async () => {
      try {
        const list = await refreshGuilds();
        if (list[0]) await loadGuild(list[0].id);
      } catch (err) {
        setError((err as Error).message);
      }
    })();

    return () => {
      socket.off('presence:update');
      socket.off('message:new');
      socket.off('voice:peers');
      socket.off('voice:newProducer');
      socket.off('voice:peerLeft');
      socket.off('guild:refresh');
    };
  }, [token, user.id, refreshGuilds, loadGuild]);

  useEffect(() => {
    if (!channelId || !activeChannel || activeChannel.type !== 'text') {
      setMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getMessages(token, channelId);
        if (!cancelled) setMessages(res.messages);
        const socket = socketRef.current;
        if (socket) await emitAck(socket, 'channel:join', { channelId });
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, channelId, activeChannel]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    const content = draft.trim();
    if (!content || !channelId || !socketRef.current) return;
    setDraft('');
    try {
      await emitAck(socketRef.current, 'message:send', { channelId, content });
    } catch (err) {
      setError((err as Error).message);
      setDraft(content);
    }
  }

  async function joinVoice(ch: Channel) {
    if (!socketRef.current) return;
    setError('');
    try {
      await startVoice(socketRef.current, ch.id);
      setChannelId(ch.id);
      setInVoice(true);
      setMutedState(isMuted());
    } catch (err) {
      setError((err as Error).message);
      setInVoice(false);
    }
  }

  async function leaveVoiceChannel() {
    if (!socketRef.current) return;
    await stopVoice(socketRef.current);
    setInVoice(false);
    setMutedState(false);
    setVoicePeers([]);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  }

  async function logout() {
    await stopVoice(socketRef.current || undefined);
    disconnectSocket();
    onLogout();
  }

  const onlineIds = new Set(presence.map((p) => p.userId));
  const voiceByUser = new Map(presence.map((p) => [p.userId, p.voiceChannelId]));

  return (
    <div className="app-shell">
      <aside className="server-rail">
        {guilds.map((g) => (
          <button
            key={g.id}
            className={`server-btn ${g.id === guildId ? 'active' : ''}`}
            title={g.name}
            onClick={() => loadGuild(g.id)}
          >
            {initials(g.name)}
          </button>
        ))}
        <button className="rail-action" title="创建服务器" onClick={() => setModal('create')}>
          +
        </button>
        <button className="rail-action" title="加入服务器" onClick={() => setModal('join')}>
          ↓
        </button>
      </aside>

      <aside className="channel-pane">
        <div className="guild-header">
          <h2>{activeGuild?.name || '选择服务器'}</h2>
          {activeGuild ? <div className="invite">邀请码 {activeGuild.invite_code}</div> : null}
        </div>
        <div className="channel-list">
          <div className="channel-section">文字频道</div>
          {channels
            .filter((c) => c.type === 'text')
            .map((c) => (
              <button
                key={c.id}
                className={`channel-item ${c.id === channelId ? 'active' : ''}`}
                onClick={() => setChannelId(c.id)}
              >
                <span className="prefix">#</span>
                {c.name}
              </button>
            ))}
          <div className="channel-section">语音频道</div>
          {channels
            .filter((c) => c.type === 'voice')
            .map((c) => (
              <button
                key={c.id}
                className={`channel-item ${c.id === channelId ? 'active' : ''}`}
                onClick={() => {
                  setChannelId(c.id);
                }}
              >
                <span className="prefix">🔊</span>
                {c.name}
                {getActiveVoiceChannelId() === c.id ? ' · 已加入' : ''}
              </button>
            ))}
        </div>
        <div className="user-bar">
          <span>{user.username}</span>
          <button type="button" onClick={logout}>
            退出
          </button>
        </div>
      </aside>

      <main className="main-pane">
        {error ? (
          <div className="main-header" style={{ color: 'var(--danger)' }}>
            {error}
          </div>
        ) : null}
        {!activeChannel ? (
          <div className="empty-state">创建一个服务器，或用邀请码加入。</div>
        ) : activeChannel.type === 'text' ? (
          <div className="chat-view">
            <div className="main-header">
              <span>#</span>
              <span>{activeChannel.name}</span>
            </div>
            <div className="messages">
              {messages.map((m) => (
                <div className="message" key={m.id}>
                  <div>
                    <span className="author">{m.username}</span>
                    <span className="time">{m.created_at}</span>
                  </div>
                  <div className="body">{m.content}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div className="composer">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`发送到 #${activeChannel.name}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <button type="button" onClick={() => void sendMessage()}>
                发送
              </button>
            </div>
          </div>
        ) : (
          <div className="voice-view">
            <div className="voice-card">
              <h3>{activeChannel.name}</h3>
              <p>加入语音后可与同频道成员实时通话。公网部署请配置 MEDIASOUP_ANNOUNCED_IP。</p>
              <div className="voice-peers">
                {(inVoice ? voicePeers : []).map((p) => (
                  <div className="voice-peer" key={p.userId}>
                    <div className="avatar">{initials(p.username)}</div>
                    <span>
                      {p.username}
                      {p.userId === user.id ? '（我）' : ''}
                    </span>
                  </div>
                ))}
                {!inVoice ? <div className="empty-state">尚未加入语音</div> : null}
              </div>
              <div className="voice-actions">
                {!inVoice ? (
                  <button className="primary" type="button" onClick={() => void joinVoice(activeChannel)}>
                    加入语音
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={toggleMute}>
                      {muted ? '取消静音' : '静音'}
                    </button>
                    <button className="danger" type="button" onClick={() => void leaveVoiceChannel()}>
                      离开语音
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <aside className="member-pane">
        <h3>成员 — {members.length}</h3>
        {members.map((m) => {
          const voiceCh = voiceByUser.get(m.id);
          const voiceName = voiceCh ? channels.find((c) => c.id === voiceCh)?.name : null;
          return (
            <div className="member-item" key={m.id}>
              <div className="avatar">{initials(m.username)}</div>
              <div className="meta">
                <div className="name">{m.username}</div>
                <div className="status">
                  {onlineIds.has(m.id)
                    ? voiceName
                      ? `语音 · ${voiceName}`
                      : '在线'
                    : '离线'}
                </div>
              </div>
            </div>
          );
        })}
      </aside>

      {modal === 'create' ? (
        <PromptModal
          title="创建服务器"
          label="服务器名称"
          placeholder="例：技术讨论"
          confirmText="创建"
          onClose={() => setModal(null)}
          onSubmit={async (name) => {
            const res = await api.createGuild(token, name);
            await refreshGuilds();
            await loadGuild(res.guild.id);
          }}
        />
      ) : null}
      {modal === 'join' ? (
        <PromptModal
          title="加入服务器"
          label="邀请码"
          placeholder="8 位邀请码"
          confirmText="加入"
          onClose={() => setModal(null)}
          onSubmit={async (code) => {
            const res = await api.joinGuild(token, code);
            await refreshGuilds();
            await loadGuild(res.guild.id);
          }}
        />
      ) : null}
    </div>
  );
}

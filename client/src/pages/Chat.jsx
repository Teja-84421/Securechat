import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, getToken, API_URL } from '../api';
import { useAuth } from '../AuthContext';
import { encryptMessage, decryptMessage, encryptVoice, decryptVoice } from '../crypto';
import Rail from '../components/Rail';
import Avatar from '../components/Avatar';
import Icon from '../components/Icons';
import MessageBubble from '../components/MessageBubble';
import MessageMenu from '../components/MessageMenu';
import VoiceRecorderBar from '../components/VoiceRecorderBar';
import RoomDialog from '../components/RoomDialog';
import InfoPanel from '../components/InfoPanel';
import ProfileDialog from '../components/ProfileDialog';
import EmojiPicker from '../components/EmojiPicker';

const EDIT_WINDOW_MS = 15 * 60 * 1000; // keep in sync with server/socket.js
const GROUP_GAP_MS = 5 * 60 * 1000;

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}
// Two neighbouring messages belong to one "run" if same sender, same day, within 5 minutes
const linked = (a, b) =>
  !!a && !!b && a.mine === b.mine && sameDay(a.time, b.time) && Math.abs(new Date(b.time) - new Date(a.time)) < GROUP_GAP_MS;

export default function Chat() {
  const { user, signOut } = useAuth();
  const [rooms, setRooms] = useState([]);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState(null); // the other person's user id
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState({});
  const [unread, setUnread] = useState({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [menu, setMenu] = useState(null); // { id, anchor, mode }
  const [editing, setEditing] = useState(null); // { id }
  const [recording, setRecording] = useState(false);
  const [roomDialog, setRoomDialog] = useState(null); // null | 'create' | 'join'
  const [infoOpen, setInfoOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const socketRef = useRef(null);
  const roomsRef = useRef([]);
  const usersRef = useRef([]);
  const activeRef = useRef(null);
  const typingTimers = useRef({});
  const iAmTyping = useRef(false);
  const stopTypingTimer = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const voiceUrls = useRef(new Map()); // message id -> decrypted audio object URL
  const noticeTimer = useRef(null);

  // People I share an active room with (nobody else is ever listed)
  const peers = useMemo(
    () => rooms.filter((r) => r.peer).map((r) => ({ ...r.peer, roomId: r.id })),
    [rooms]
  );
  const waiting = rooms.filter((r) => !r.peer);
  roomsRef.current = rooms;
  usersRef.current = peers;
  const peer = peers.find((u) => u.id === activeId) || null;
  const activeRoom = rooms.find((r) => r.peer?.id === activeId) || null;
  const unreadTotal = Object.values(unread).reduce((a, b) => a + b, 0);

  const flash = useCallback((text) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 2600);
  }, []);

  const loadRooms = useCallback(async () => {
    try {
      const { rooms: next } = await api.rooms();
      // A waiting room just became active: tell the creator
      next.forEach((r) => {
        if (r.peer && roomsRef.current.some((p) => p.id === r.id && !p.peer)) flash(`${r.peer.username} joined your room`);
      });
      setRooms(next);
      setRoomsLoaded(true);
      return next;
    } catch (err) {
      if (err.status === 401) signOut();
      else setError(err.message);
      return [];
    }
  }, [signOut, flash]);

  // Find a peer (refetching if the room list is out of date)
  const getPeer = useCallback(
    async (id) =>
      usersRef.current.find((u) => u.id === id) || (await loadRooms()).find((r) => r.peer?.id === id)?.peer,
    [loadRooms]
  );

  // Server row -> what the UI renders
  const toView = useCallback(
    (m, text) => ({
      id: m.id,
      mine: m.sender_id === user.id,
      type: m.type || 'text',
      text,
      time: m.created_at,
      editedAt: m.edited_at || null,
      deletedAt: m.deleted_at || null,
      durationMs: m.duration_ms || 0,
      reactions: m.reactions || [],
    }),
    [user.id]
  );

  const decryptRow = useCallback(
    async (m, p) => {
      if (m.type === 'voice' || m.deleted_at || !m.ciphertext || !p?.public_key) return null;
      return decryptMessage(user.id, p.public_key, m.ciphertext, m.iv);
    },
    [user.id]
  );

  // ---- Socket.IO connection (JWT sent in the handshake) ----
  useEffect(() => {
    loadRooms();
    const socket = io(API_URL || undefined, { auth: { token: getToken() } });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      loadRooms(); // refresh online status after (re)connecting
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => {
      if (err.message === 'Unauthorized') signOut();
    });

    socket.on('presence', ({ userId, online }) =>
      setRooms((list) => list.map((r) => (r.peer?.id === userId ? { ...r, peer: { ...r.peer, online } } : r)))
    );

    // A room was created, joined, cancelled or closed (or a peer's key changed)
    socket.on('rooms:changed', async () => {
      const list = await loadRooms();
      if (activeRef.current && !list.some((r) => r.peer?.id === activeRef.current)) {
        closeChat();
        flash('That room was closed');
      }
    });

    socket.on('typing', ({ from, isTyping }) => {
      setTyping((t) => ({ ...t, [from]: isTyping }));
      clearTimeout(typingTimers.current[from]);
      if (isTyping) {
        typingTimers.current[from] = setTimeout(() => setTyping((t) => ({ ...t, [from]: false })), 3000);
      }
    });

    // Incoming ciphertext -> decrypt in the browser -> display
    socket.on('message:new', async (m) => {
      const otherId = m.sender_id === user.id ? m.receiver_id : m.sender_id;
      if (otherId === activeRef.current) {
        const p = await getPeer(otherId);
        const text = await decryptRow(m, p);
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, toView(m, text)]));
        setTyping((t) => ({ ...t, [otherId]: false }));
      } else if (m.sender_id !== user.id) {
        setUnread((u) => ({ ...u, [otherId]: (u[otherId] || 0) + 1 }));
      }
    });

    // Someone edited a message: decrypt the new ciphertext and swap it in
    socket.on('message:edited', async (e) => {
      const p = usersRef.current.find((u) => u.id === activeRef.current);
      if (!p?.public_key) return;
      const text = await decryptMessage(user.id, p.public_key, e.ciphertext, e.iv);
      setMessages((prev) => prev.map((x) => (x.id === e.id ? { ...x, text, editedAt: e.edited_at } : x)));
    });

    socket.on('message:deleted', ({ id, deleted_at }) => {
      setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, text: null, deletedAt: deleted_at, reactions: [] } : x)));
      const url = voiceUrls.current.get(id);
      if (url) {
        URL.revokeObjectURL(url);
        voiceUrls.current.delete(id);
      }
    });

    socket.on('message:hidden', ({ id }) => setMessages((prev) => prev.filter((x) => x.id !== id)));

    socket.on('reaction:update', ({ id, reactions }) =>
      setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, reactions } : x)))
    );

    return () => {
      socket.disconnect();
      Object.values(typingTimers.current).forEach(clearTimeout);
      clearTimeout(noticeTimer.current);
      voiceUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stay at the bottom only when a message is added (not for reactions/edits)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, typing, activeId]);

  async function selectUser(id) {
    stopTyping();
    setActiveId(id);
    activeRef.current = id;
    setUnread((u) => ({ ...u, [id]: 0 }));
    setMessages([]);
    setError('');
    setDraft('');
    setMenu(null);
    setEditing(null);
    setRecording(false);
    setEmojiOpen(false);
    setLoadingHistory(true);
    try {
      const [{ messages: raw }, p] = await Promise.all([api.history(id), getPeer(id)]);
      const view = await Promise.all(raw.map(async (m) => toView(m, await decryptRow(m, p))));
      if (activeRef.current === id) setMessages(view);
    } catch (err) {
      setError(err.message);
    } finally {
      if (activeRef.current === id) setLoadingHistory(false);
    }
  }

  function closeChat() {
    stopTyping();
    setActiveId(null);
    activeRef.current = null;
    setMenu(null);
    setEditing(null);
    setRecording(false);
    setInfoOpen(false);
    setEmojiOpen(false);
  }

  function stopTyping() {
    clearTimeout(stopTypingTimer.current);
    if (iAmTyping.current && activeRef.current) {
      socketRef.current?.emit('typing', { to: activeRef.current, isTyping: false });
    }
    iAmTyping.current = false;
  }

  function handleDraftChange(e) {
    setDraft(e.target.value);
    if (!peer || editing) return;
    if (!iAmTyping.current) {
      iAmTyping.current = true;
      socketRef.current?.emit('typing', { to: peer.id, isTyping: true });
    }
    clearTimeout(stopTypingTimer.current);
    stopTypingTimer.current = setTimeout(stopTyping, 1500);
  }

  // ---- Rooms ----
  async function copyCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      flash('Code copied');
    } catch {
      flash('Couldn’t copy');
    }
  }

  async function cancelRoom(id) {
    try {
      await api.closeRoom(id);
      await loadRooms();
      flash('Room cancelled');
    } catch (err) {
      setError(err.message);
    }
  }

  async function closeActiveRoom() {
    if (!activeRoom) return;
    try {
      await api.closeRoom(activeRoom.id);
      closeChat();
      await loadRooms();
      flash('Room closed');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleJoined(room) {
    setRoomDialog(null);
    await loadRooms();
    if (room.peer) selectUser(room.peer.id);
  }

  // ---- Sending, editing ----
  async function handleSubmit(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !peer?.public_key) return;
    setError('');
    setEmojiOpen(false);
    if (editing) return commitEdit(text);

    setDraft('');
    stopTyping();
    try {
      // 1. Encrypt in the browser  2. Send only ciphertext + IV
      const { ciphertext, iv } = await encryptMessage(user.id, peer.public_key, text);
      socketRef.current.emit('message:send', { to: peer.id, ciphertext, iv }, (res) => {
        if (!res?.ok) return setError(res?.error || 'Message was not sent');
        if (activeRef.current !== res.message.receiver_id) return;
        setMessages((prev) => (prev.some((x) => x.id === res.message.id) ? prev : [...prev, toView(res.message, text)]));
      });
    } catch (err) {
      setError(err.message || 'Encryption failed');
    }
  }

  async function commitEdit(text) {
    const target = messages.find((m) => m.id === editing.id);
    if (!target || target.text === text) return cancelEdit();
    try {
      const { ciphertext, iv } = await encryptMessage(user.id, peer.public_key, text);
      socketRef.current.emit('message:edit', { id: editing.id, ciphertext, iv }, (res) => {
        if (!res?.ok) setError(res?.error || 'Could not edit message');
      });
      cancelEdit();
    } catch (err) {
      setError(err.message || 'Encryption failed');
    }
  }

  function startEdit(m) {
    setEditing({ id: m.id });
    setDraft(m.text);
    setRecording(false);
    setEmojiOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function cancelEdit() {
    setEditing(null);
    setDraft('');
  }

  function pickEmoji(emoji) {
    setDraft((d) => d + emoji);
    inputRef.current?.focus();
  }

  // ---- Voice ----
  async function handleVoice(blob, durationMs) {
    setRecording(false);
    if (!peer?.public_key) return;
    try {
      const { ciphertext, iv } = await encryptVoice(user.id, peer.public_key, blob);
      socketRef.current.emit('message:send', { to: peer.id, ciphertext, iv, type: 'voice', durationMs }, (res) => {
        if (!res?.ok) return setError(res?.error || 'Voice message was not sent');
        voiceUrls.current.set(res.message.id, URL.createObjectURL(blob)); // play my own message without re-downloading
        if (activeRef.current !== res.message.receiver_id) return;
        setMessages((prev) => (prev.some((x) => x.id === res.message.id) ? prev : [...prev, toView(res.message, null)]));
      });
    } catch (err) {
      setError(err.message || 'Encryption failed');
    }
  }

  // Download + decrypt a voice message the first time it is played
  const loadVoice = useCallback(
    async (m) => {
      const cached = voiceUrls.current.get(m.id);
      if (cached) return cached;
      const p = usersRef.current.find((u) => u.id === activeRef.current);
      const { ciphertext, iv } = await api.audio(m.id);
      const blob = await decryptVoice(user.id, p.public_key, ciphertext, iv);
      if (!blob) throw new Error('Could not decrypt voice message');
      const url = URL.createObjectURL(blob);
      voiceUrls.current.set(m.id, url);
      return url;
    },
    [user.id]
  );

  // ---- Message menu actions ----
  const openMenu = useCallback((m, rect, mode) => {
    setMenu({
      id: m.id,
      mode,
      anchor: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
    });
  }, []);

  const reactTo = (m, emoji) =>
    socketRef.current.emit('message:react', { id: m.id, emoji }, (res) => {
      if (!res?.ok) setError(res?.error || 'Could not add reaction');
    });

  const toggleReaction = (m, emoji) => {
    const mine = m.reactions.find((r) => r.user_id === user.id);
    reactTo(m, mine?.emoji === emoji ? null : emoji);
  };

  const deleteMessage = (m, scope) =>
    socketRef.current.emit('message:delete', { id: m.id, scope }, (res) => {
      if (!res?.ok) return setError(res?.error || 'Could not delete message');
      if (scope === 'me') setMessages((prev) => prev.filter((x) => x.id !== m.id));
    });

  async function copyText(m) {
    try {
      await navigator.clipboard.writeText(m.text);
      flash('Copied');
    } catch {
      flash('Couldn’t copy');
    }
  }

  const menuMessage = menu ? messages.find((m) => m.id === menu.id) : null;
  const canEdit = (m) =>
    m.mine && m.type === 'text' && !m.deletedAt && m.text !== null && Date.now() - new Date(m.time).getTime() < EDIT_WINDOW_MS;

  const filtered = useMemo(
    () => peers.filter((u) => u.username.toLowerCase().includes(search.trim().toLowerCase())),
    [peers, search]
  );

  const canType = !!peer?.public_key;
  const hasText = draft.trim().length > 0;
  const noRooms = roomsLoaded && rooms.length === 0;

  return (
    <div className={`app ${activeId ? 'has-active' : ''} ${infoOpen && peer ? 'info-open' : ''}`}>
      <Rail
        user={user}
        connected={connected}
        unreadTotal={unreadTotal}
        onNewRoom={() => setRoomDialog('create')}
        onProfile={() => setProfileOpen(true)}
        onSignOut={signOut}
      />

      {/* ---------- Conversation list ---------- */}
      <aside className="list">
        <header className="list-head">
          <h1>Chats</h1>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setRoomDialog('create')}>
            <Icon name="plus" size={16} /> New room
          </button>
        </header>

        {peers.length > 0 && (
          <label className="search-wrap">
            <Icon name="search" size={18} />
            <input
              className="search"
              type="search"
              placeholder="Search your chats"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search your chats"
            />
          </label>
        )}

        <div className="list-scroll">
          {waiting.length > 0 && (
            <section className="list-section">
              <h2>Waiting for a friend</h2>
              {waiting.map((r) => (
                <div className="waiting-item" key={r.id}>
                  <span className="waiting-icon"><Icon name="key" size={20} /></span>
                  <span className="waiting-meta">
                    <code>{r.code}</code>
                    <small>Share this code to start</small>
                  </span>
                  <button type="button" className="icon-btn small" onClick={() => copyCode(r.code)} aria-label={`Copy code ${r.code}`}>
                    <Icon name="copy" size={17} />
                  </button>
                  <button type="button" className="icon-btn small danger" onClick={() => cancelRoom(r.id)} aria-label={`Cancel room ${r.code}`}>
                    <Icon name="x" size={17} />
                  </button>
                </div>
              ))}
            </section>
          )}

          {peers.length > 0 && (
            <section className="list-section">
              <h2>Conversations</h2>
              <ul>
                {filtered.map((u) => (
                  <li key={u.id}>
                    <button className={`user-item ${u.id === activeId ? 'active' : ''}`} onClick={() => selectUser(u.id)}>
                      <Avatar name={u.username} online={u.online} />
                      <span className="user-meta">
                        <strong>{u.username}</strong>
                        <small className={typing[u.id] ? 'is-typing' : ''}>
                          {typing[u.id] ? 'typing…' : u.online ? 'Online' : 'Offline'}
                        </small>
                      </span>
                      {unread[u.id] > 0 && <span className="badge">{unread[u.id]}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              {filtered.length === 0 && <p className="empty-note">No chats match that search.</p>}
            </section>
          )}

          {noRooms && (
            <div className="list-empty">
              <span className="empty-mark small"><Icon name="key" size={26} /></span>
              <h2>No chats yet</h2>
              <p>Chats happen in private rooms. Create one and share the code, or join a friend’s room.</p>
              <button type="button" className="btn btn-primary" onClick={() => setRoomDialog('create')}>Create a room</button>
              <button type="button" className="btn btn-ghost" onClick={() => setRoomDialog('join')}>Join with a code</button>
            </div>
          )}
        </div>

        <button type="button" className="join-bar" onClick={() => setRoomDialog('join')}>
          <Icon name="enter" size={18} /> Have a code? Join a room
        </button>
      </aside>

      {/* ---------- Conversation ---------- */}
      <section className="stage">
        {!peer ? (
          <div className="stage-empty">
            <span className="empty-mark"><Icon name="lock" size={32} /></span>
            <h2>Private rooms for two</h2>
            <ol className="how-mini">
              <li><b>1</b> Create a room and copy its code</li>
              <li><b>2</b> Send the code to your friend</li>
              <li><b>3</b> Chat. Everything is encrypted</li>
            </ol>
            <div className="stage-actions">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => setRoomDialog('create')}>Create a room</button>
              <button type="button" className="btn btn-ghost btn-lg" onClick={() => setRoomDialog('join')}>Join with a code</button>
            </div>
          </div>
        ) : (
          <>
            <header className="stage-head">
              <button className="icon-btn back" onClick={closeChat} aria-label="Back to chats">
                <Icon name="back" />
              </button>
              <Avatar name={peer.username} size={44} online={peer.online} />
              <div className="stage-title">
                <strong>{peer.username}</strong>
                <small className={typing[peer.id] ? 'is-typing' : ''}>
                  {typing[peer.id] ? 'typing…' : peer.online ? 'Online' : 'Offline'}
                </small>
              </div>
              <span className="e2e-badge"><Icon name="lock" size={14} /> Encrypted</span>
              <button
                type="button"
                className={`icon-btn ${infoOpen ? 'on' : ''}`}
                onClick={() => setInfoOpen((v) => !v)}
                aria-label="Chat details"
                aria-pressed={infoOpen}
                title="Chat details"
              >
                <Icon name="info" />
              </button>
            </header>

            <div className="messages" onScroll={() => menu && setMenu(null)}>
              {loadingHistory && <div className="empty-note">Decrypting messages…</div>}
              {!loadingHistory && messages.length === 0 && (
                <div className="first-hello">
                  <Avatar name={peer.username} size={64} />
                  <h3>You’re in a room with {peer.username}</h3>
                  <p>Say hello, or send a voice note. Only the two of you can read it.</p>
                </div>
              )}
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const next = messages[i + 1];
                const a = linked(prev, m);
                const b = linked(m, next);
                const pos = a ? (b ? 'middle' : 'last') : b ? 'first' : 'single';
                return (
                  <Fragment key={m.id}>
                    {(i === 0 || !sameDay(prev.time, m.time)) && (
                      <div className="day-sep"><span>{dayLabel(m.time)}</span></div>
                    )}
                    <MessageBubble
                      m={m}
                      myId={user.id}
                      pos={pos}
                      onOpenMenu={openMenu}
                      onToggleReaction={toggleReaction}
                      loadVoice={loadVoice}
                    />
                  </Fragment>
                );
              })}
              {typing[peer.id] && (
                <div className="bubble-row theirs pos-single">
                  <div className="msg-col">
                    <div className="bubble typing-bubble" aria-label={`${peer.username} is typing`}>
                      <i /><i /><i />
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {error && (
              <div className="form-error chat-error" role="alert">
                <span>{error}</span>
                <button type="button" className="icon-btn small" onClick={() => setError('')} aria-label="Dismiss">
                  <Icon name="x" size={16} />
                </button>
              </div>
            )}
            {!peer.public_key && (
              <div className="form-error chat-error">
                {peer.username} hasn’t set up encryption keys yet. They need to open the app once.
              </div>
            )}

            {recording ? (
              <VoiceRecorderBar
                onSend={handleVoice}
                onCancel={() => setRecording(false)}
                onError={(msg) => setError(msg)}
              />
            ) : (
              <div className="composer-wrap">
                {editing && (
                  <div className="edit-banner">
                    <Icon name="edit" size={16} />
                    <span>Editing message</span>
                    <button type="button" className="icon-btn small" onClick={cancelEdit} aria-label="Cancel editing">
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                )}
                <form className="composer" onSubmit={handleSubmit}>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setEmojiOpen((v) => !v)}
                    disabled={!canType}
                    aria-label="Insert emoji"
                    aria-expanded={emojiOpen}
                  >
                    <Icon name="smile" size={22} />
                  </button>
                  <input
                    ref={inputRef}
                    value={draft}
                    onChange={handleDraftChange}
                    onKeyDown={(e) => e.key === 'Escape' && editing && cancelEdit()}
                    placeholder={editing ? 'Edit your message' : `Message ${peer.username}`}
                    maxLength={1000}
                    disabled={!canType}
                    aria-label="Message"
                  />
                  {hasText ? (
                    <button className="send-btn" disabled={!canType || !connected} aria-label={editing ? 'Save edit' : 'Send message'}>
                      <Icon name={editing ? 'check' : 'send'} size={20} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="send-btn mic"
                      onClick={() => { setError(''); setEmojiOpen(false); setRecording(true); }}
                      disabled={!canType || !connected || !!editing}
                      aria-label="Record voice message"
                    >
                      <Icon name="mic" size={20} />
                    </button>
                  )}
                </form>
                {emojiOpen && <EmojiPicker onPick={pickEmoji} onClose={() => setEmojiOpen(false)} />}
              </div>
            )}
          </>
        )}
        {notice && <div className="toast" role="status">{notice}</div>}
      </section>

      {infoOpen && peer && (
        <InfoPanel
          peer={peer}
          room={activeRoom}
          online={peer.online}
          myPublicKey={user.public_key}
          onClose={() => setInfoOpen(false)}
          onLeave={closeActiveRoom}
        />
      )}

      {profileOpen && (
        <ProfileDialog user={user} connected={connected} onClose={() => setProfileOpen(false)} onSignOut={signOut} />
      )}

      {roomDialog && (
        <RoomDialog
          key={roomDialog}
          initialTab={roomDialog}
          onClose={() => setRoomDialog(null)}
          onChanged={loadRooms}
          onJoined={handleJoined}
        />
      )}

      {menu && menuMessage && (
        <MessageMenu
          key={menu.id}
          message={menuMessage}
          anchor={menu.anchor}
          mode={menu.mode}
          myReaction={menuMessage.reactions.find((r) => r.user_id === user.id)?.emoji}
          canEdit={canEdit(menuMessage)}
          onReact={(emoji) => reactTo(menuMessage, emoji)}
          onEdit={() => startEdit(menuMessage)}
          onCopy={() => copyText(menuMessage)}
          onDelete={(scope) => deleteMessage(menuMessage, scope)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

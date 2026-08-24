import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { connectSocket, releaseSocket } from '../api/socket';
import Icon from './Icon.jsx';
import { getTeacherId, readAuthToken } from '../utils/localCache.js';
import { getOrSyncSnapshot, queueMutation } from '../utils/snapshotSync.js';
import { saveSnapshot } from '../utils/localDb.js';
import { useLocale } from '../context/LocaleContext.jsx';

const MESSAGE_RETENTION_MS = 24 * 60 * 60 * 1000;

function messageKey(message) {
  return message?.client_message_id || message?.id;
}

function isFreshMessage(message) {
  const createdAt = new Date(message?.created_at || 0).getTime();
  return Number.isFinite(createdAt) && Date.now() - createdAt < MESSAGE_RETENTION_MS;
}

function freshMessages(items) {
  return (Array.isArray(items) ? items : []).filter(isFreshMessage);
}

function mergeMessageList(current, incoming) {
  if (!incoming || !isFreshMessage(incoming)) return current;
  const incomingKey = messageKey(incoming);
  const existingIndex = current.findIndex((message) => messageKey(message) === incomingKey || (message.client_message_id && message.client_message_id === incoming.client_message_id) || (message.id === incoming.id));
  if (existingIndex < 0) return [...current, incoming].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const next = [...current];
  next[existingIndex] = { ...next[existingIndex], ...incoming };
  return next;
}

export default function ChatWidget() {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [unread, setUnread] = useState(0);
  const [status, setStatus] = useState('');
  const scrollRef = useRef(null);
  const openRef = useRef(open);
  const teacherId = getTeacherId();

  useEffect(() => { openRef.current = open; }, [open]);

  const loadHistory = useCallback(async () => {
    try {
      const local = await getOrSyncSnapshot(teacherId);
      if (local?.messages) setMessages(freshMessages(local.messages));
      if (openRef.current) setUnread(0);
      // Refresh the conversation without blocking the local first paint.
      api.get('/messages').then(({ data }) => setMessages(freshMessages(data.messages))).catch(() => undefined);
    } catch {
      setStatus(t('chatLocalOnly'));
    }
  }, [teacherId, t]);

  useEffect(() => {
    const token = readAuthToken();
    if (!token || !teacherId) return undefined;
    void loadHistory();
    const onConnect = () => setStatus('');
    const onReconnect = () => { setStatus(''); void loadHistory(); };
    const onError = () => setStatus(t('chatReconnecting'));
    const onNewMessage = (message) => {
      setMessages((current) => mergeMessageList(current, message));
      if (message.sender === 'admin' && !openRef.current) setUnread((value) => value + 1);
    };
    const socket = connectSocket(token, { onConnect, onReconnect, onError });
    socket.on('new_message', onNewMessage);
    return () => {
      socket.off('new_message', onNewMessage);
      releaseSocket(socket, { onConnect, onReconnect, onError });
    };
  }, [loadHistory, teacherId]);

  const toggleOpen = () => setOpen((value) => {
    const next = !value;
    if (next) void loadHistory();
    return next;
  });

  useEffect(() => {
    const timer = window.setInterval(() => setMessages((current) => freshMessages(current)), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, open]);

  const send = async (event) => {
    event.preventDefault();
    const draft = text.trim();
    if (!draft) return;
    const clientMessageId = `message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic = { id: `local-${clientMessageId}`, client_message_id: clientMessageId, sender: 'teacher', text: draft, created_at: new Date().toISOString() };
    setText('');
    setMessages((current) => mergeMessageList(current, optimistic));
    try {
      const { data } = await api.post('/messages', { text: draft, client_message_id: clientMessageId });
      setMessages((current) => mergeMessageList(current, data.message));
      setStatus('');
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: '/messages', data: { text: draft, client_message_id: clientMessageId } });
      setStatus(t('chatSavedLocally'));
      // Keep the optimistic message visible; the next snapshot replaces it with the server copy.
      try {
        const local = await getOrSyncSnapshot(teacherId);
        await saveSnapshot(teacherId, { ...local, messages: mergeMessageList(local?.messages || [], optimistic) });
      } catch { /* local message is already visible in this component */ }
    }
  };

  return <div className="fixed bottom-5 left-5 z-40">{open && <div className="mb-3 w-80 max-w-[90vw] card shadow-xl flex flex-col overflow-hidden" style={{ height: 420 }}><div className="bg-primary text-white px-4 py-3 flex items-center justify-between"><span className="font-bold text-sm">{t('chatSupport')}</span><button onClick={() => setOpen(false)} className="text-white/80 hover:text-white">×</button></div><div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-surface">{status && <p className="text-xs text-accent text-center">{status}</p>}{messages.length === 0 && <p className="text-ink/40 text-xs text-center mt-6">{t('chatNoMessages')}</p>}{messages.map((message) => <div key={messageKey(message)} className={`max-w-[80%] px-3 py-2 rounded-xl2 text-sm ${message.sender === 'teacher' ? 'bg-primary text-white mr-auto' : 'bg-white border border-line ml-auto'}`}>{message.text}<div className={`text-[10px] mt-1 ${message.sender === 'teacher' ? 'text-white/70' : 'text-ink/40'}`}>{new Date(message.created_at).toLocaleTimeString(locale === 'ar' ? 'ar' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</div></div>)}</div><form onSubmit={send} className="p-2 border-t border-line flex gap-2 bg-white"><input className="input text-sm flex-1" placeholder={t('chatInputPlaceholder')} value={text} onChange={(event) => setText(event.target.value)} /><button className="btn-primary text-sm px-3" type="submit">{t('chatSend')}</button></form></div>}<button onClick={toggleOpen} className="relative w-14 h-14 rounded-full bg-primary text-white shadow-lg flex items-center justify-center hover:bg-primary-dark transition-colors"><Icon name="messageCircle" className="w-6 h-6" />{unread > 0 && !open && <span className="absolute -top-1 -right-1 bg-danger text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center">{unread}</span>}</button></div>;
}

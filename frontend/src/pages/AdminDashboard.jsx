import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import adminApi from '../api/adminClient';
import { connectSocket } from '../api/socket';

const PLAN_LABELS = { '6_months': '6 أشهر', yearly: 'سنوية', lifetime: 'مدى الحياة' };
const STATUS_LABELS = { pending: 'قيد المراجعة', approved: 'مُفعّل', rejected: 'مرفوض' };

function chatMessageKey(message) {
  return message?.client_message_id || message?.id;
}

function mergeChatMessage(current, incoming) {
  if (!incoming) return current;
  const key = chatMessageKey(incoming);
  const index = current.findIndex((message) => chatMessageKey(message) === key || (message.client_message_id && message.client_message_id === incoming.client_message_id));
  if (index < 0) return [...current, incoming].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const next = [...current];
  next[index] = { ...next[index], ...incoming };
  return next;
}

function PaymentRequests() {
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [showArchived, setShowArchived] = useState(false);
  const [viewReceipt, setViewReceipt] = useState(null);

  const load = async () => {
    const { data } = await adminApi.get('/admin/payment-requests', {
      params: { ...(statusFilter ? { status: statusFilter } : {}), archived: showArchived ? '1' : '0' },
    });
    setRequests(data.requests);
  };
  useEffect(() => { load(); }, [statusFilter, showArchived]);

  const approve = async (id) => {
    if (!confirm('تأكيد استلام التحويل وتفعيل الاشتراك؟')) return;
    await adminApi.post(`/admin/payment-requests/${id}/approve`, {});
    load();
  };
  const reject = async (id) => {
    const note = prompt('سبب الرفض (اختياري):') || '';
    await adminApi.post(`/admin/payment-requests/${id}/reject`, { admin_note: note });
    load();
  };
  const archive = async (id) => {
    await adminApi.post(`/admin/payment-requests/${id}/archive`, {});
    load();
  };
  const restore = async (id) => {
    await adminApi.post(`/admin/payment-requests/${id}/restore`, {});
    load();
  };
  const remove = async (id) => {
    if (!confirm('حذف هذا الطلب نهائيًا؟ لا يمكن التراجع عن هذا الإجراء.')) return;
    await adminApi.delete(`/admin/payment-requests/${id}`);
    load();
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex gap-2">
          {['pending', 'approved', 'rejected', ''].map((s) => (
            <button key={s || 'all'} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-full text-xs border ${statusFilter === s ? 'bg-ink text-white border-ink' : 'border-line'}`}>
              {s ? STATUS_LABELS[s] : 'الكل'}
            </button>
          ))}
        </div>
        <button onClick={() => setShowArchived((v) => !v)}
          className={`px-3 py-1 rounded-full text-xs border ${showArchived ? 'bg-accent text-white border-accent' : 'border-line text-ink/60'}`}>
          {showArchived ? '📦 عرض الأرشيف' : 'عرض الأرشيف'}
        </button>
      </div>

      <div className="space-y-3">
        {requests.map((r) => (
          <div key={r.id} className="card p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {r.receipt_image ? (
                <button onClick={() => setViewReceipt(r.receipt_image)}>
                  <img src={r.receipt_image} alt="وصل التحويل" className="w-14 h-14 object-cover rounded-lg border border-line" />
                </button>
              ) : (
                <div className="w-14 h-14 rounded-lg border border-dashed border-line flex items-center justify-center text-[10px] text-ink/40 text-center">لا يوجد وصل</div>
              )}
              <div>
                <p className="font-bold">{r.full_name} <span className="text-ink/50 text-xs">({r.email})</span></p>
                <p className="text-sm text-ink/70">الباقة: {PLAN_LABELS[r.plan]} — {r.amount_omr} ر.ع</p>
                {r.reference_note && <p className="text-xs text-ink/50">ملاحظة المعلم: {r.reference_note}</p>}
                <p className="text-xs text-ink/40">{new Date(r.created_at).toLocaleString('ar')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-1 rounded-full ${r.status === 'pending' ? 'bg-accent/20 text-ink' : r.status === 'approved' ? 'bg-primary/20 text-primary' : 'bg-danger/20 text-danger'}`}>
                {STATUS_LABELS[r.status]}
              </span>
              {r.status === 'pending' && !showArchived && (
                <>
                  <button className="btn-primary text-xs" onClick={() => approve(r.id)}>تفعيل</button>
                  <button className="text-danger text-xs" onClick={() => reject(r.id)}>رفض</button>
                </>
              )}
              {showArchived ? (
                <>
                  <button className="text-primary text-xs" onClick={() => restore(r.id)}>استعادة</button>
                  <button className="text-danger text-xs" onClick={() => remove(r.id)}>حذف نهائي</button>
                </>
              ) : (
                <button className="text-ink/50 text-xs" onClick={() => archive(r.id)}>أرشفة</button>
              )}
            </div>
          </div>
        ))}
        {requests.length === 0 && <p className="text-ink/50 text-sm">لا توجد طلبات في هذه الفئة.</p>}
      </div>

      {viewReceipt && (
        <div className="fixed inset-0 bg-ink/70 z-50 flex items-center justify-center p-4" onClick={() => setViewReceipt(null)}>
          <img src={viewReceipt} alt="وصل التحويل" className="max-h-[85vh] max-w-full rounded-lg" />
        </div>
      )}
    </>
  );
}

function TeachersList({ onMessage }) {
  const [teachers, setTeachers] = useState([]);
  useEffect(() => { adminApi.get('/admin/teachers').then(({ data }) => setTeachers(data.teachers)); }, []);

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface"><tr>
          <th className="text-right px-4 py-2">الاسم</th>
          <th className="text-right px-4 py-2">البريد</th>
          <th className="text-right px-4 py-2">الباقة</th>
          <th className="text-right px-4 py-2">الحالة</th>
          <th className="px-4 py-2"></th>
        </tr></thead>
        <tbody>
          {teachers.map((t) => (
            <tr key={t.id} className="border-t border-line">
              <td className="px-4 py-2">{t.full_name}</td>
              <td className="px-4 py-2 text-ink/60">{t.email}</td>
              <td className="px-4 py-2">{PLAN_LABELS[t.plan] || t.plan}</td>
              <td className="px-4 py-2">{t.status}</td>
              <td className="px-4 py-2 text-left"><button className="text-primary text-xs" onClick={() => onMessage(t)}>مراسلة</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BroadcastComposer({ onSent }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (!confirm('سيتم إرسال هذه الرسالة إلى جميع المعلمين المسجلين. متابعة؟')) return;
    setBusy(true);
    try {
      const { data } = await adminApi.post('/admin/broadcast', { text });
      setResult(`تم الإرسال إلى ${data.sentTo} معلمًا ✓`);
      setText('');
      onSent?.();
      setTimeout(() => setResult(''), 3000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-3 mb-3">
      {!open ? (
        <button className="text-primary text-sm font-medium" onClick={() => setOpen(true)}>📢 إرسال رسالة جماعية لكل المعلمين</button>
      ) : (
        <form onSubmit={send} className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">رسالة جماعية لكل المعلمين</span>
            <button type="button" className="text-ink/40 text-xs" onClick={() => setOpen(false)}>إغلاق</button>
          </div>
          <textarea className="input text-sm" rows={3} placeholder="اكتب الرسالة التي ستصل لكل المعلمين..." value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex items-center gap-2">
            <button className="btn-primary text-sm" disabled={busy} type="submit">{busy ? '...' : 'إرسال للجميع'}</button>
            {result && <span className="text-primary text-xs">{result}</span>}
          </div>
        </form>
      )}
    </div>
  );
}

function ChatPanel({ initialTeacher }) {
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(initialTeacher || null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const socketRef = useRef(null);
  const scrollRef = useRef(null);

  const loadConversations = async () => {
    const { data } = await adminApi.get('/admin/conversations');
    setConversations(data.conversations);
  };

  useEffect(() => {
    loadConversations();
    const token = localStorage.getItem('educore_admin_token');
    if (!token) return undefined;
    const socket = connectSocket(token, {
      onReconnect: loadConversations,
      onError: (err) => console.warn('Admin chat connection error', err.message),
    });
    socketRef.current = socket;
    socket.on('new_message', (msg) => {
      setConversations((prev) => {
        const existing = prev.find((conversation) => conversation.teacher_id === msg.teacher_id);
        if (!existing) {
          void loadConversations();
          return prev;
        }
        const updated = {
          ...existing,
          last_message: msg.text,
          last_message_at: msg.created_at,
          unread_count: msg.sender === 'teacher' ? Number(existing.unread_count || 0) + 1 : existing.unread_count,
        };
        return [updated, ...prev.filter((conversation) => conversation.teacher_id !== msg.teacher_id)];
      });
      setActive((current) => {
        if (current && current.teacher_id === msg.teacher_id) setMessages((prev) => mergeChatMessage(prev, msg));
        return current;
      });
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (initialTeacher) setActive(initialTeacher);
  }, [initialTeacher]);

  useEffect(() => {
    if (!active) return;
    adminApi.get(`/admin/messages/${active.teacher_id}`).then(({ data }) => setMessages(data.messages || []));
    socketRef.current?.emit('join_conversation', active.teacher_id);
    setConversations((prev) => prev.map((conversation) => (
      conversation.teacher_id === active.teacher_id
        ? { ...conversation, unread_count: 0 }
        : conversation
    )));
  }, [active]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || !active) return;
    const draft = text.trim();
    setText('');
    const clientMessageId = `admin-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic = {
      id: `local-${clientMessageId}`,
      client_message_id: clientMessageId,
      teacher_id: active.teacher_id,
      sender: 'admin',
      text: draft,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => mergeChatMessage(prev, optimistic));
    try {
      const { data } = await adminApi.post(`/admin/messages/${active.teacher_id}`, { text: draft, client_message_id: clientMessageId });
      setMessages((prev) => mergeChatMessage(prev, data.message));
    } catch (err) {
      setMessages((prev) => prev.filter((message) => chatMessageKey(message) !== clientMessageId));
      setText(draft);
      console.error('Unable to send admin message', err);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-3">
        <BroadcastComposer onSent={loadConversations} />
      </div>
      <div className="card overflow-y-auto" style={{ height: 500 }}>
        {conversations.map((c) => (
          <button key={c.teacher_id} onClick={() => setActive(c)}
            className={`w-full text-right p-3 border-b border-line hover:bg-surface ${active?.teacher_id === c.teacher_id ? 'bg-surface' : ''}`}>
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{c.full_name}</span>
              {c.unread_count > 0 && <span className="bg-danger text-white text-[10px] rounded-full px-1.5 py-0.5">{c.unread_count}</span>}
            </div>
            <p className="text-xs text-ink/50 truncate">{c.last_message}</p>
          </button>
        ))}
        {conversations.length === 0 && <p className="text-ink/50 text-sm p-4">لا توجد محادثات بعد. راسل معلمًا من تبويب "كل المعلمين".</p>}
      </div>

      <div className="card md:col-span-2 flex flex-col overflow-hidden" style={{ height: 500 }}>
        {!active ? (
          <p className="text-ink/50 text-sm p-6">اختر محادثة لعرضها.</p>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-line font-bold text-sm">{active.full_name}</div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-surface">
              {messages.map((m) => (
                <div key={m.id} className={`max-w-[75%] px-3 py-2 rounded-xl2 text-sm ${m.sender === 'admin' ? 'bg-primary text-white mr-auto' : 'bg-white border border-line ml-auto'}`}>
                  {m.text}
                  <div className={`text-[10px] mt-1 ${m.sender === 'admin' ? 'text-white/70' : 'text-ink/40'}`}>
                    {new Date(m.created_at).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={send} className="p-2 border-t border-line flex gap-2">
              <input className="input text-sm flex-1" placeholder="اكتب ردًا..." value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn-primary text-sm px-3" type="submit">إرسال</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('requests');
  const [chatTarget, setChatTarget] = useState(null);

  useEffect(() => {
    if (!localStorage.getItem('educore_admin_token')) navigate('/admin/login');
  }, [navigate]);

  const logout = () => { localStorage.removeItem('educore_admin_token'); navigate('/admin/login'); };

  const goToChat = (teacher) => {
    setChatTarget({ teacher_id: teacher.id, full_name: teacher.full_name });
    setTab('chat');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">لوحة تحكم المسؤول</h1>
        <button className="btn-secondary text-sm" onClick={logout}>تسجيل الخروج</button>
      </div>

      <div className="flex gap-2 mb-5">
        <button onClick={() => setTab('requests')} className={`px-3 py-1.5 rounded-full text-sm border ${tab === 'requests' ? 'bg-primary text-white border-primary' : 'border-line'}`}>طلبات التفعيل</button>
        <button onClick={() => setTab('teachers')} className={`px-3 py-1.5 rounded-full text-sm border ${tab === 'teachers' ? 'bg-primary text-white border-primary' : 'border-line'}`}>كل المعلمين</button>
        <button onClick={() => setTab('chat')} className={`px-3 py-1.5 rounded-full text-sm border ${tab === 'chat' ? 'bg-primary text-white border-primary' : 'border-line'}`}>الدردشة مع المعلمين</button>
      </div>

      {tab === 'requests' && <PaymentRequests />}
      {tab === 'teachers' && <TeachersList onMessage={goToChat} />}
      {tab === 'chat' && <ChatPanel initialTeacher={chatTarget} />}
    </div>
  );
}

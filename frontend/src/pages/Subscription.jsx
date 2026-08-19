import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext.jsx';
import { omrWithEquivalent } from '../constants.js';
import { resizeImageFile } from '../utils/image.js';

const PLANS = [
  { id: '6_months', title: 'باقة 6 أشهر' },
  { id: 'yearly', title: 'الباقة السنوية', highlight: true, note: 'الأكثر توفيرًا' },
  { id: 'lifetime', title: 'مدى الحياة', note: 'دفعة واحدة، وصول دائم (عدد محدود)' },
];

const STATUS_LABELS = { pending: 'قيد المراجعة', approved: 'مُفعّل ✓', rejected: 'مرفوض' };
const PLAN_LABELS = { trial: 'فترة تجريبية', '6_months': 'باقة 6 أشهر', yearly: 'الباقة السنوية', lifetime: 'مدى الحياة' };

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' });
}

// "تفاصيل التفعيل" card: shows activation date and days remaining for whichever plan is active,
// trial or paid — so the teacher always knows exactly where they stand without digging.
function SubscriptionDetailsCard() {
  const { subscriptionInfo } = useAuth();
  if (!subscriptionInfo) return null;
  const { plan, status, startDate, endDate, daysLeft, expired } = subscriptionInfo;

  return (
    <div className="card p-5 mb-6">
      <h3 className="font-bold text-sm mb-3">تفاصيل الاشتراك الحالي</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-ink/50 text-xs mb-1">الباقة</p>
          <p className="font-medium">{PLAN_LABELS[plan] || plan}</p>
        </div>
        <div>
          <p className="text-ink/50 text-xs mb-1">تاريخ التفعيل</p>
          <p className="font-medium">{formatDate(startDate)}</p>
        </div>
        <div>
          <p className="text-ink/50 text-xs mb-1">تاريخ الانتهاء</p>
          <p className="font-medium">{endDate ? formatDate(endDate) : 'مدى الحياة'}</p>
        </div>
        <div>
          <p className="text-ink/50 text-xs mb-1">متبقي حتى الانتهاء</p>
          <p className={`font-bold ${expired ? 'text-danger' : daysLeft !== null && daysLeft <= 4 ? 'text-accent' : 'text-primary'}`}>
            {daysLeft === null ? 'غير محدود' : expired ? 'منتهي' : `${daysLeft} يوم`}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Subscription() {
  const { subscription, refreshMe } = useAuth();
  const [prices, setPrices] = useState({});
  const [phone, setPhone] = useState('');
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [referenceNote, setReferenceNote] = useState('');
  const [receiptImage, setReceiptImage] = useState('');
  const [myRequests, setMyRequests] = useState([]);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const activationRef = useRef(null);

  const loadRequests = async () => {
    const { data } = await api.get('/auth/payment-requests');
    setMyRequests(data.requests);
  };

  useEffect(() => {
    api.get('/auth/plans').then(({ data }) => { setPrices(data.prices_omr); setPhone(data.payment_phone); });
    loadRequests();
  }, []);

  // Choosing a plan should always take the teacher straight to "إتمام التفعيل" — scroll it into view
  // instead of leaving them to notice a new section appended below the fold.
  useEffect(() => {
    if (selectedPlan) activationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedPlan]);

  const handleReceipt = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await resizeImageFile(file, 500, 0.7);
    setReceiptImage(dataUrl);
  };

  const submitRequest = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/payment-requests', { plan: selectedPlan, reference_note: referenceNote, receipt_image: receiptImage });
      setSubmitted(true);
      setSelectedPlan(null);
      setReferenceNote('');
      setReceiptImage('');
      loadRequests();
      refreshMe();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link to="/" className="text-primary text-sm">→ العودة للوحة التحكم</Link>
      <h1 className="text-3xl font-bold mt-4 mb-2">ترقية الاشتراك</h1>
      <p className="text-ink/60 mb-6">
        الحالة الحالية: <span className="font-medium">{subscription?.plan === 'trial' ? 'فترة تجريبية' : subscription?.plan}</span>
      </p>

      <SubscriptionDetailsCard />

      {myRequests.length > 0 && (
        <div className="card p-4 mb-6">
          <h3 className="font-bold text-sm mb-2">طلبات التفعيل السابقة</h3>
          <div className="space-y-1">
            {myRequests.map((r) => (
              <div key={r.id} className="flex justify-between text-sm border-b border-line pb-1">
                <span>{r.plan} — {r.amount_omr} ر.ع</span>
                <span className={r.status === 'approved' ? 'text-primary' : r.status === 'rejected' ? 'text-danger' : 'text-accent'}>
                  {STATUS_LABELS[r.status]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {PLANS.map((p) => (
          <div key={p.id} className={`card p-6 flex flex-col ${p.highlight ? 'ring-2 ring-primary' : ''} ${selectedPlan === p.id ? 'ring-2 ring-accent' : ''}`}>
            {p.highlight && <span className="text-xs text-accent font-bold mb-2">الأكثر جاذبية</span>}
            <h3 className="text-xl font-bold mb-1">{p.title}</h3>
            <p className="text-2xl font-bold text-primary mb-1">{prices[p.id] ? omrWithEquivalent(prices[p.id]) : '...'}</p>
            {p.note && <p className="text-sm text-ink/60 mb-4">{p.note}</p>}
            <button className="btn-primary mt-auto" onClick={() => setSelectedPlan(p.id)}>اختيار هذه الباقة</button>
          </div>
        ))}
      </div>

      {selectedPlan && (
        <div ref={activationRef} className="card p-6 scroll-mt-6">
          <h3 className="font-bold mb-3">إتمام التفعيل عبر التحويل البنكي / المحفظة الرقمية</h3>
          <ol className="list-decimal list-inside text-sm text-ink/80 space-y-2 mb-5">
            <li>حوّل مبلغ <span className="font-bold text-primary">{omrWithEquivalent(prices[selectedPlan])}</span> إلى الرقم: <span className="font-bold">{phone}</span></li>
            <li>أرفق لقطة شاشة لوصل التحويل (أو اكتب رقم/مرجع العملية) في النموذج أدناه.</li>
            <li>سيصل طلبك مباشرة إلى مالك التطبيق للمراجعة، وسيتم تفعيل اشتراكك خلال وقت قصير.</li>
          </ol>

          {submitted ? (
            <p className="text-primary font-medium">تم إرسال طلبك بنجاح ✓ سيتم تفعيل الاشتراك بعد مراجعة التحويل.</p>
          ) : (
            <form onSubmit={submitRequest} className="space-y-3">
              <div>
                <label className="label">رقم/مرجع عملية التحويل أو اسم المُحوِّل</label>
                <input className="input" value={referenceNote} onChange={(e) => setReferenceNote(e.target.value)} placeholder="مثال: تحويل باسم أحمد - 123456" />
              </div>
              <div>
                <label className="label">صورة وصل التحويل (اختياري)</label>
                <input type="file" accept="image/*" onChange={handleReceipt} className="text-sm" />
                {receiptImage && <img src={receiptImage} alt="وصل" className="mt-2 max-h-40 rounded-lg border border-line" />}
              </div>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={busy} type="submit">{busy ? '...' : 'إرسال طلب التفعيل'}</button>
                <button className="btn-secondary" type="button" onClick={() => setSelectedPlan(null)}>إلغاء</button>
              </div>
            </form>
          )}
        </div>
      )}

      <p className="text-xs text-ink/40 mt-6">التفعيل يتم يدويًا بعد التأكد من استلام التحويل — عادة خلال ساعات قليلة.</p>
    </div>
  );
}

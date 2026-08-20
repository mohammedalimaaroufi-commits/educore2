import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext.jsx';
import { omrWithEquivalent } from '../constants.js';
import { resizeImageFile } from '../utils/image.js';

const FALLBACK_PLANS = [
  { id: '6_months', title: 'باقة 6 أشهر' },
  { id: 'yearly', title: 'الباقة السنوية', highlight: true, note: 'الأكثر توفيرًا' },
  { id: 'lifetime', title: 'مدى الحياة', note: 'دفعة واحدة، وصول دائم' },
];
const STATUS_LABELS = { pending: 'قيد المراجعة', approved: 'مُفعّل ✓', rejected: 'مرفوض' };
const PLAN_LABELS = { trial: 'فترة تجريبية', '6_months': 'باقة 6 أشهر', yearly: 'الباقة السنوية', lifetime: 'مدى الحياة' };

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' });
}

function SubscriptionDetailsCard() {
  const { subscriptionInfo } = useAuth();
  if (!subscriptionInfo) return null;
  const { plan, status, startDate, endDate, daysLeft, expired } = subscriptionInfo;
  return (
    <div className="card p-5 mb-6">
      <h3 className="font-bold text-sm mb-3">تفاصيل الاشتراك الحالي</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div><p className="text-ink/50 text-xs mb-1">الباقة</p><p className="font-medium">{PLAN_LABELS[plan] || plan}</p></div>
        <div><p className="text-ink/50 text-xs mb-1">تاريخ التفعيل</p><p className="font-medium">{formatDate(startDate)}</p></div>
        <div><p className="text-ink/50 text-xs mb-1">تاريخ الانتهاء</p><p className="font-medium">{endDate ? formatDate(endDate) : 'مدى الحياة'}</p></div>
        <div><p className="text-ink/50 text-xs mb-1">متبقي حتى الانتهاء</p><p className={`font-bold ${expired ? 'text-danger' : daysLeft !== null && daysLeft <= 4 ? 'text-accent' : 'text-primary'}`}>{daysLeft === null ? 'غير محدود' : expired ? 'منتهي' : `${daysLeft} يوم`}</p></div>
      </div>
      {status !== 'active' && <p className="text-xs text-accent mt-3">حالة الاشتراك الحالية: {status}</p>}
    </div>
  );
}

export default function Subscription() {
  const { subscription, refreshMe } = useAuth();
  const [plans, setPlans] = useState([]);
  const [phone, setPhone] = useState('');
  const [trialDays, setTrialDays] = useState(14);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [referenceNote, setReferenceNote] = useState('');
  const [receiptImage, setReceiptImage] = useState('');
  const [myRequests, setMyRequests] = useState([]);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const activationRef = useRef(null);

  const loadRequests = async () => {
    const { data } = await api.get('/auth/payment-requests');
    setMyRequests(data.requests || []);
  };

  useEffect(() => {
    api.get('/auth/plans').then(({ data }) => {
      setPlans((data.plans || []).map((plan) => ({ ...plan, ...(FALLBACK_PLANS.find((item) => item.id === plan.id) || {}) })));
      setPhone(data.payment_phone || '');
      setTrialDays(Number(data.trial_days || 14));
    }).catch(() => setPlans(FALLBACK_PLANS));
    loadRequests().catch(() => setMyRequests([]));
  }, []);

  useEffect(() => {
    if (selectedPlan) activationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedPlan]);

  const selected = plans.find((plan) => plan.id === selectedPlan);
  const priceFor = (plan) => Number(plan?.price_omr ?? plan?.base_price_omr ?? 0);
  const originalPriceFor = (plan) => Number(plan?.original_price_omr ?? plan?.base_price_omr ?? priceFor(plan));

  const handleReceipt = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setReceiptImage(await resizeImageFile(file, 500, 0.7));
  };

  const submitRequest = async (e) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      await api.post('/auth/payment-requests', { plan: selected.id, offer_id: selected.offer?.id || null, reference_note: referenceNote, receipt_image: receiptImage });
      setSubmitted(true);
      setSelectedPlan(null);
      setReferenceNote('');
      setReceiptImage('');
      await loadRequests();
      refreshMe();
    } finally {
      setBusy(false);
    }
  };

  const visiblePlans = plans.length ? plans : FALLBACK_PLANS;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link to="/" className="text-primary text-sm">→ العودة للوحة التحكم</Link>
      <h1 className="text-3xl font-bold mt-4 mb-2">إدارة الاشتراك</h1>
      <p className="text-ink/60 mb-2">الحالة الحالية: <span className="font-medium">{PLAN_LABELS[subscription?.plan] || subscription?.plan}</span></p>
      <p className="text-xs text-ink/50 mb-6">الفترة التجريبية الافتراضية للحسابات الجديدة: <strong>{trialDays} يومًا</strong>، ويمكن للمسؤول تغييرها.</p>

      <SubscriptionDetailsCard />

      {myRequests.length > 0 && <div className="card p-4 mb-6"><h3 className="font-bold text-sm mb-2">طلبات التفعيل السابقة</h3><div className="space-y-1">{myRequests.map((request) => <div key={request.id} className="flex justify-between text-sm border-b border-line pb-1"><span>{PLAN_LABELS[request.plan] || request.plan} — {request.amount_omr} ر.ع {request.original_amount_omr && Number(request.original_amount_omr) > Number(request.amount_omr) ? <del className="text-ink/40 mr-1">{request.original_amount_omr}</del> : null}</span><span className={request.status === 'approved' ? 'text-primary' : request.status === 'rejected' ? 'text-danger' : 'text-accent'}>{STATUS_LABELS[request.status]}</span></div>)}</div></div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {visiblePlans.map((plan) => {
          const price = priceFor(plan);
          const original = originalPriceFor(plan);
          const hasOffer = Boolean(plan.offer && original > price);
          return <div key={plan.id} className={`card p-6 flex flex-col ${plan.highlight ? 'ring-2 ring-primary' : ''} ${selectedPlan === plan.id ? 'ring-2 ring-accent' : ''}`}>
            {plan.highlight && <span className="text-xs text-accent font-bold mb-2">الأكثر جاذبية</span>}
            {hasOffer && <span className="inline-flex self-start text-xs bg-danger/10 text-danger px-2 py-1 rounded-full font-bold mb-2">{plan.offer.title || 'عرض خاص'}</span>}
            <h3 className="text-xl font-bold mb-1">{plan.title || PLAN_LABELS[plan.id] || plan.id}</h3>
            {hasOffer && <p className="text-sm text-ink/40 line-through mb-1">{omrWithEquivalent(original)}</p>}
            <p className="text-2xl font-bold text-primary mb-1">{price ? omrWithEquivalent(price) : '...'}</p>
            {hasOffer && plan.offer.description && <p className="text-sm text-danger mb-2">{plan.offer.description}</p>}
            {plan.note && <p className="text-sm text-ink/60 mb-4">{plan.note}</p>}
            <button className="btn-primary mt-auto" onClick={() => setSelectedPlan(plan.id)}>اختيار هذه الباقة</button>
          </div>;
        })}
      </div>

      {selected && <div ref={activationRef} className="card p-6 scroll-mt-6">
        <h3 className="font-bold mb-3">إتمام التفعيل عبر التحويل البنكي / المحفظة الرقمية</h3>
        <ol className="list-decimal list-inside text-sm text-ink/80 space-y-2 mb-5"><li>حوّل مبلغ <span className="font-bold text-primary">{omrWithEquivalent(priceFor(selected))}</span> إلى الرقم: <span className="font-bold">{phone}</span></li><li>أرفق لقطة شاشة لوصل التحويل أو اكتب رقم العملية.</li><li>يراجع المسؤول الطلب يدويًا، ثم يفعّل الاشتراك بعد التأكد من التحويل.</li></ol>
        {submitted ? <p className="text-primary font-medium">تم إرسال طلبك بنجاح ✓ سيتم تفعيل الاشتراك بعد مراجعة التحويل.</p> : <form onSubmit={submitRequest} className="space-y-3"><div><label className="label">رقم/مرجع عملية التحويل أو اسم المُحوِّل</label><input className="input" value={referenceNote} onChange={(e) => setReferenceNote(e.target.value)} placeholder="مثال: تحويل باسم أحمد - 123456" /></div><div><label className="label">صورة وصل التحويل (اختياري)</label><input type="file" accept="image/*" onChange={handleReceipt} className="text-sm" />{receiptImage && <img src={receiptImage} alt="وصل" className="mt-2 max-h-40 rounded-lg border border-line" />}</div><div className="flex gap-2"><button className="btn-primary" disabled={busy} type="submit">{busy ? '...' : 'إرسال طلب التفعيل'}</button><button className="btn-secondary" type="button" onClick={() => setSelectedPlan(null)}>إلغاء</button></div></form>}
      </div>}
      <p className="text-xs text-ink/40 mt-6">التفعيل يتم يدويًا بعد التأكد من استلام التحويل.</p>
    </div>
  );
}

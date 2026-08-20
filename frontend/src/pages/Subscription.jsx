import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext.jsx';
import { omrWithEquivalent } from '../constants.js';
import { resizeImageFile } from '../utils/image.js';

const FALLBACK_PLANS = [
  { id: '6_months', title: 'باقة 6 أشهر', base_price_omr: 4, price_omr: 4, original_price_omr: 4, duration_days: 182 },
  { id: 'yearly', title: 'الباقة السنوية', highlight: true, note: 'الأكثر توفيرًا', base_price_omr: 7, price_omr: 7, original_price_omr: 7, duration_days: 365 },
  { id: 'lifetime', title: 'مدى الحياة', note: 'دفعة واحدة، وصول دائم', base_price_omr: 18, price_omr: 18, original_price_omr: 18, duration_days: null },
];
const STATUS_LABELS = { active: 'مفعّل', pending: 'قيد المراجعة', approved: 'مُفعّل ✓', rejected: 'مرفوض', expired: 'منتهي' };
const PLAN_LABELS = { trial: 'فترة تجريبية', '6_months': 'باقة 6 أشهر', yearly: 'الباقة السنوية', lifetime: 'مدى الحياة' };

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' });
}

function SubscriptionDetailsCard() {
  const { subscriptionInfo } = useAuth();
  if (!subscriptionInfo) return null;
  const { plan, status, startDate, endDate, daysLeft, expired } = subscriptionInfo;
  const statusLabel = expired ? 'منتهي' : (STATUS_LABELS[status] || status || 'غير محدد');
  return (
    <section className="subscription-current-card">
      <div className="subscription-current-card__heading"><div><span className="subscription-eyebrow">الحساب الحالي</span><h3>تفاصيل الاشتراك الحالي</h3></div><span className={`subscription-status-badge ${expired ? 'is-expired' : status === 'active' ? 'is-active' : 'is-pending'}`}>{statusLabel}</span></div>
      <div className="subscription-details-grid">
        <div><p>الباقة</p><strong>{PLAN_LABELS[plan] || plan || 'غير محددة'}</strong></div>
        <div><p>تاريخ التفعيل</p><strong>{formatDate(startDate)}</strong></div>
        <div><p>تاريخ الانتهاء</p><strong>{endDate ? formatDate(endDate) : 'مدى الحياة'}</strong></div>
        <div><p>المتبقي</p><strong className={expired ? 'is-danger' : daysLeft !== null && daysLeft <= 4 ? 'is-warning' : 'is-good'}>{daysLeft === null ? 'غير محدود' : expired ? 'منتهي' : `${daysLeft} يوم`}</strong></div>
      </div>
      {status !== 'active' && !expired && <p className="subscription-current-card__note">حالة الاشتراك الحالية: {statusLabel}. يمكنك إرسال طلب تفعيل جديد من الباقات أدناه.</p>}
    </section>
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
      setPlans((data.plans || []).map((plan) => ({ ...(FALLBACK_PLANS.find((item) => item.id === plan.id) || {}), ...plan })));
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
      refreshMe({ force: true });
    } finally {
      setBusy(false);
    }
  };

  const visiblePlans = plans.length ? plans : FALLBACK_PLANS;

  return (
    <div className="subscription-page-shell">
      <div className="subscription-page-topline"><Link to="/" className="subscription-back">← العودة للوحة التحكم</Link><span className="subscription-local-note">تفعيل يدوي آمن · بياناتك محفوظة محليًا</span></div>
      <header className="subscription-page-hero"><div><span className="subscription-eyebrow">الخطوة التالية في رحلتك التعليمية</span><h1>إدارة الاشتراك</h1><p>اختر الباقة المناسبة، راجع تفاصيل حسابك، واستفد من العروض الفعّالة التي يحددها المسؤول.</p></div><div className="subscription-hero-orbit"><span>Edu<br />Core</span></div></header>
      <div className="subscription-current-summary"><span>الحالة الحالية</span><strong>{STATUS_LABELS[subscription?.status] || PLAN_LABELS[subscription?.plan] || 'فترة تجريبية'}</strong><small>الفترة التجريبية الافتراضية للحسابات الجديدة: {trialDays} يومًا</small></div>

      <SubscriptionDetailsCard />

      {myRequests.length > 0 && <section className="subscription-requests-card"><div className="subscription-section-heading"><div><span className="subscription-eyebrow">سجل الطلبات</span><h3>طلبات التفعيل السابقة</h3></div><span>{myRequests.length} طلب</span></div><div className="subscription-requests-list">{myRequests.map((request) => <div key={request.id} className="subscription-request-row"><span><strong>{PLAN_LABELS[request.plan] || request.plan}</strong><small>{request.amount_omr} ر.ع {request.original_amount_omr && Number(request.original_amount_omr) > Number(request.amount_omr) ? <del>{request.original_amount_omr} ر.ع</del> : null}</small></span><span className={request.status === 'approved' ? 'is-good' : request.status === 'rejected' ? 'is-danger' : 'is-warning'}>{STATUS_LABELS[request.status]}</span></div>)}</div></section>}

      <div className="subscription-section-heading subscription-plans-heading"><div><span className="subscription-eyebrow">خطط مرنة</span><h2>اختر الباقة المناسبة</h2><p>العروض المفعّلة تظهر هنا تلقائيًا مع السعر الأصلي والسعر المخفّض.</p></div></div><div className="subscription-plans-grid">
        {visiblePlans.map((plan) => {
          const price = priceFor(plan);
          const original = originalPriceFor(plan);
          const hasOffer = Boolean(plan.offer && original > price);
          return <article key={plan.id} className={`subscription-plan-card ${plan.highlight ? 'is-highlighted' : ''} ${selectedPlan === plan.id ? 'is-selected' : ''}`}>
            {plan.highlight && <span className="subscription-plan-ribbon">الأكثر جاذبية</span>}
            {hasOffer && <span className="subscription-offer-badge">{plan.offer.title || 'عرض خاص'}</span>}
            <h3>{plan.title || PLAN_LABELS[plan.id] || plan.id}</h3>
            {hasOffer && <p className="subscription-original-price">{omrWithEquivalent(original)}</p>}
            <p className="subscription-plan-price">{price ? omrWithEquivalent(price) : '...'}</p>
            {hasOffer && plan.offer.description && <p className="subscription-offer-description">{plan.offer.description}</p>}
            {plan.note && <p className="subscription-plan-note">{plan.note}</p>}
            <button className="btn-primary" onClick={() => setSelectedPlan(plan.id)}>اختيار هذه الباقة</button>
          </article>;
        })}
      </div>

      {selected && <section ref={activationRef} className="subscription-activation-card scroll-mt-6">
        <h3 className="font-bold mb-3">إتمام التفعيل عبر التحويل البنكي / المحفظة الرقمية</h3>
        <ol className="list-decimal list-inside text-sm text-ink/80 space-y-2 mb-5"><li>حوّل مبلغ <span className="font-bold text-primary">{omrWithEquivalent(priceFor(selected))}</span> إلى الرقم: <span className="font-bold">{phone}</span></li><li>أرفق لقطة شاشة لوصل التحويل أو اكتب رقم العملية.</li><li>يراجع المسؤول الطلب يدويًا، ثم يفعّل الاشتراك بعد التأكد من التحويل.</li></ol>
        {submitted ? <p className="text-primary font-medium">تم إرسال طلبك بنجاح ✓ سيتم تفعيل الاشتراك بعد مراجعة التحويل.</p> : <form onSubmit={submitRequest} className="space-y-3"><div><label className="label">رقم/مرجع عملية التحويل أو اسم المُحوِّل</label><input className="input" value={referenceNote} onChange={(e) => setReferenceNote(e.target.value)} placeholder="مثال: تحويل باسم أحمد - 123456" /></div><div><label className="label">صورة وصل التحويل (اختياري)</label><input type="file" accept="image/*" onChange={handleReceipt} className="text-sm" />{receiptImage && <img src={receiptImage} alt="وصل" className="mt-2 max-h-40 rounded-lg border border-line" />}</div><div className="flex gap-2"><button className="btn-primary" disabled={busy} type="submit">{busy ? '...' : 'إرسال طلب التفعيل'}</button><button className="btn-secondary" type="button" onClick={() => setSelectedPlan(null)}>إلغاء</button></div></form>}
      </section>}
      <p className="subscription-footnote">التفعيل يتم يدويًا بعد التأكد من استلام التحويل.</p>
    </div>
  );
}

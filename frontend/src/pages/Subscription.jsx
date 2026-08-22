import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext.jsx';
import { omrWithEquivalent } from '../constants.js';
import { resizeImageFile } from '../utils/image.js';
import { useLocale } from '../context/LocaleContext.jsx';

const FALLBACK_PLANS = [
  { id: '6_months', title: 'باقة 6 أشهر', base_price_omr: 4, price_omr: 4, original_price_omr: 4, duration_days: 182, note: 'وصول كامل لمدة نصف عام', features: ['دفتر درجات كامل', 'الحضور والسلوك', 'التحليلات والتقارير'] },
  { id: 'yearly', title: 'الباقة السنوية', highlight: true, base_price_omr: 7, price_omr: 7, original_price_omr: 7, duration_days: 365, note: 'الأكثر توفيرًا للعام الدراسي', features: ['كل أدوات EduCore', 'نسخ محلية ومزامنة', 'دعم فني مباشر'] },
  { id: 'lifetime', title: 'مدى الحياة', note: 'دفعة واحدة، وصول دائم', base_price_omr: 18, price_omr: 18, original_price_omr: 18, duration_days: null, features: ['وصول دائم', 'كل التحديثات المستقبلية', 'أولوية في الدعم'] },
];

const PLAN_ALIASES = {
  annual: 'yearly', year: 'yearly', '12_months': 'yearly', '12-months': 'yearly',
  '6_month': '6_months', '6months': '6_months', '6-months': '6_months', '6 أشهر': '6_months',
  'باقة 6 أشهر': '6_months', سنوية: 'yearly', 'الباقة السنوية': 'yearly', 'مدى الحياة': 'lifetime',
  'فترة تجريبية': 'trial', trial: 'trial',
};

function canonicalPlanForUi(value) {
  const raw = String(value || '').trim();
  return ['trial', '6_months', 'yearly', 'lifetime'].includes(raw) ? raw : PLAN_ALIASES[raw] || PLAN_ALIASES[raw.toLowerCase()] || raw || 'trial';
}

function validDateValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? value : null;
}

function firstValidDate(...values) {
  return values.map(validDateValue).find(Boolean) || null;
}

function formatDate(iso, locale, withTime = false) {
  const valid = validDateValue(iso);
  if (!valid) return '—';
  const date = new Date(valid);
  return date.toLocaleDateString(locale === 'ar' ? 'ar' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function planLabel(plan, t) {
  const customTitle = plan && typeof plan === 'object' ? String(plan.title || '').trim() : '';
  const canonical = canonicalPlanForUi(plan && typeof plan === 'object' ? plan.id : plan);
  return customTitle || ({
    trial: t('planTrial'),
    '6_months': t('planSixMonths'),
    yearly: t('planYearly'),
    lifetime: t('planLifetime'),
  }[canonical] || String(plan || t('planTrial')));
}

function statusLabel(status, t) {
  return {
    active: t('statusActive'), pending: t('statusPending'), approved: t('statusApproved'),
    rejected: t('statusRejected'), expired: t('statusExpired'),
  }[status] || status || t('statusActive');
}

function priceNumber(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function discountPercent(original, price) {
  if (!original || !price || original <= price) return 0;
  return Math.round(((original - price) / original) * 100);
}

function SubscriptionDetailsCard() {
  const { subscriptionInfo, restrictions } = useAuth();
  const { t, locale } = useLocale();
  if (!subscriptionInfo) return null;

  const plan = canonicalPlanForUi(subscriptionInfo.plan);
  const isTrial = plan === 'trial';
  const isLifetime = plan === 'lifetime';
  const startDate = isTrial
    ? firstValidDate(subscriptionInfo.startDate, subscriptionInfo.trialStartDate, subscriptionInfo.trial_start_date)
    : firstValidDate(subscriptionInfo.startDate, subscriptionInfo.currentPeriodStart, subscriptionInfo.current_period_start);
  const endDate = isTrial
    ? firstValidDate(subscriptionInfo.endDate, subscriptionInfo.trialEndDate, subscriptionInfo.trial_end_date)
    : firstValidDate(subscriptionInfo.endDate, subscriptionInfo.currentPeriodEnd, subscriptionInfo.current_period_end);
  // Never trust a cached/stale daysLeft when an end date exists. The displayed
  // remaining time must be derived from that exact canonical end date.
  const daysLeft = endDate
    ? Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : (subscriptionInfo.daysLeft === null || subscriptionInfo.daysLeft === undefined ? null : Number(subscriptionInfo.daysLeft));
  const expired = endDate ? daysLeft <= 0 : Boolean(subscriptionInfo.expired || (daysLeft !== null && daysLeft <= 0));
  const currentStatusLabel = expired ? t('statusExpired') : statusLabel(subscriptionInfo.status, t);
  const planTitle = subscriptionInfo.planTitle || planLabel(plan, t);
  const offerTitle = subscriptionInfo.offerTitle || subscriptionInfo.offer_title || null;

  return (
    <section className="subscription-current-card">
      <div className="subscription-current-card__heading">
        <div><span className="subscription-eyebrow">{t('currentAccount')}</span><h3>{t('currentSubscription')}</h3></div>
        <span className={`subscription-status-badge ${expired ? 'is-expired' : subscriptionInfo.status === 'active' ? 'is-active' : 'is-pending'}`}>{currentStatusLabel}</span>
      </div>
      <div className="subscription-current-identity">
        <div><span>{t('plan')}</span><strong>{planTitle}</strong></div>
        {offerTitle && <div><span>{t('offerLabel', 'العرض')}</span><strong>{offerTitle}</strong></div>}
        {subscriptionInfo.amount !== null && subscriptionInfo.amount !== undefined && <div><span>{t('paidAmount', 'المبلغ')}</span><strong>{omrWithEquivalent(subscriptionInfo.amount)}</strong></div>}
      </div>
      <div className="subscription-details-grid">
        <div><p>{t('activatedAt')}</p><strong>{formatDate(startDate, locale)}</strong></div>
        <div><p>{t('expiresAt')}</p><strong>{isLifetime ? t('planLifetime') : formatDate(endDate, locale)}</strong></div>
        <div><p>{t('remaining')}</p><strong className={expired ? 'is-danger' : daysLeft !== null && daysLeft <= 4 ? 'is-warning' : 'is-good'}>{daysLeft === null ? (isLifetime ? t('unlimited') : isTrial ? t('trialPending') : '—') : expired ? t('statusExpired') : t('days', '', { count: daysLeft })}</strong></div>
        <div><p>{t('status')}</p><strong>{currentStatusLabel}</strong></div>
      </div>
      {subscriptionInfo.approvedAt && <p className="subscription-current-card__meta">{t('approvedAt', 'اعتمد في')}: {formatDate(subscriptionInfo.approvedAt, locale, true)}</p>}
      {subscriptionInfo.status !== 'active' && !expired && <p className="subscription-current-card__note">{t('currentStatusNote', '', { status: currentStatusLabel })}</p>}
      {restrictions?.active && restrictions.blocked_features?.length > 0 && <div className="subscription-restrictions-note"><strong>{t('restrictionsTitle')}</strong><span>{t('restrictionsNotice')}</span><small>{restrictions.blocked_features.map((feature) => t({ students: 'featureStudents', gradebook: 'featureGradebook', behavior: 'featureBehavior', attendance: 'featureAttendance', analytics: 'featureAnalytics', reports: 'featureReports' }[feature] || feature)).join(' · ')}</small></div>}
    </section>
  );
}

function RequestHistory({ requests, t, locale }) {
  const [open, setOpen] = useState(false);
  if (!requests.length) return null;
  return (
    <section className="subscription-requests-card">
      <button type="button" className="subscription-collapsible-trigger" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <span><span className="subscription-eyebrow">{t('requestHistory')}</span><strong>{t('subscriptionRequests')}</strong></span>
        <span className="subscription-collapsible-summary">{t('requestsCount', '', { count: requests.length })}<b aria-hidden="true">{open ? '−' : '+'}</b></span>
      </button>
      {open && <div className="subscription-requests-list">
        {requests.map((request) => {
          const plan = canonicalPlanForUi(request.plan);
          const title = request.plan_title || planLabel(plan, t);
          const original = priceNumber(request.original_amount_omr);
          const amount = priceNumber(request.amount_omr);
          return <article key={request.id} className="subscription-request-row">
            <div className="subscription-request-row__identity"><strong>{title}</strong>{request.offer_title && <span className="subscription-request-offer">{request.offer_title}</span>}<small>{t('submittedAt', 'أُرسل في')}: {formatDate(request.created_at, locale, true)}</small></div>
            <div className="subscription-request-row__meta"><span>{amount ? omrWithEquivalent(amount) : '—'} {original > amount && <del>{omrWithEquivalent(original)}</del>}</span><span className={request.status === 'approved' ? 'is-good' : request.status === 'rejected' ? 'is-danger' : 'is-warning'}>{statusLabel(request.status, t)}</span></div>
          </article>;
        })}
      </div>}
    </section>
  );
}

export default function Subscription() {
  const { subscription, subscriptionInfo, refreshMe } = useAuth();
  const { t, locale } = useLocale();
  const [plans, setPlans] = useState([]);
  const [phone, setPhone] = useState('');
  const [payment, setPayment] = useState({});
  const [trialDays, setTrialDays] = useState(14);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [referenceNote, setReferenceNote] = useState('');
  const [receiptImage, setReceiptImage] = useState('');
  const [myRequests, setMyRequests] = useState([]);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [requestError, setRequestError] = useState('');
  const activationRef = useRef(null);

  const loadRequests = async () => {
    const { data } = await api.get('/auth/payment-requests');
    setMyRequests(data.requests || []);
  };

  useEffect(() => {
    api.get('/auth/plans').then(({ data }) => {
      setPlans((data.plans || []).map((plan) => ({ ...(FALLBACK_PLANS.find((item) => item.id === plan.id) || {}), ...plan })));
      setPhone(data.payment_phone || data.payment?.phone || '');
      setPayment(data.payment || {});
      setTrialDays(Number(data.trial_days || 14));
    }).catch(() => setPlans(FALLBACK_PLANS));
    loadRequests().catch(() => setMyRequests([]));
    refreshMe({ force: true }).catch(() => undefined);
  }, [refreshMe]);

  const visiblePlans = plans.length ? plans : FALLBACK_PLANS;
  const selected = useMemo(() => visiblePlans.find((plan) => plan.id === selectedPlan), [visiblePlans, selectedPlan]);

  useEffect(() => {
    if (selectedPlan) activationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedPlan]);

  const priceFor = (plan) => priceNumber(plan?.price_omr ?? plan?.offer_price_omr ?? plan?.base_price_omr);
  const originalPriceFor = (plan) => priceNumber(plan?.original_price_omr ?? plan?.offer?.original_price_omr ?? plan?.base_price_omr ?? priceFor(plan));
  const offerFor = (plan) => plan?.offer || (plan?.offer_id ? { id: plan.offer_id, title: plan.offer_title, description: plan.offer_description, original_price_omr: plan.original_price_omr, offer_price_omr: plan.price_omr, starts_at: plan.offer_starts_at, ends_at: plan.offer_ends_at } : null);

  const handleReceipt = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setReceiptImage(await resizeImageFile(file, 500, 0.7));
  };

  const submitRequest = async (e) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setRequestError('');
    try {
      await api.post('/auth/payment-requests', { plan: selected.id, offer_id: selected.offer?.id || null, reference_note: referenceNote, receipt_image: receiptImage });
      setSubmitted(true);
      setSelectedPlan(null);
      setReferenceNote('');
      setReceiptImage('');
      await loadRequests();
      await refreshMe({ force: true });
    } catch (error) {
      setRequestError(error.response?.data?.error || (locale === 'ar' ? 'تعذر إرسال طلب التفعيل. تحقق من الاتصال وحاول مرة أخرى.' : 'Unable to submit the activation request. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="subscription-page-shell">
      <div className="subscription-page-fixed-header">
        <div className="subscription-page-topline"><Link to="/" className="subscription-back">{locale === 'ar' ? '← العودة للوحة التحكم' : '← Back to dashboard'}</Link><span className="subscription-local-note">{locale === 'ar' ? 'تفعيل يدوي آمن · بياناتك محفوظة محليًا' : 'Secure manual activation · data saved locally'}</span></div>
        <header className="subscription-page-hero"><div><span className="subscription-eyebrow">{t('subscriptionJourney')}</span><h1>{t('subscription')}</h1><p>{t('subscriptionDescription')}</p></div><div className="subscription-hero-orbit"><span>Edu<br />Core</span></div></header>
        <div className="subscription-current-summary"><span>{t('currentStatus')}</span><strong>{subscriptionInfo?.planTitle || (subscriptionInfo?.plan ? planLabel(subscriptionInfo.plan, t) : subscription?.plan ? planLabel(subscription.plan, t) : t('planTrial'))}</strong><small>{subscriptionInfo?.plan === 'trial' ? t('defaultTrial', '', { days: trialDays }) : statusLabel(subscriptionInfo?.status || subscription?.status, t)}</small></div>
      </div>
      <main className="subscription-page-content">
        <SubscriptionDetailsCard />
        {subscriptionInfo?.status === 'active' && canonicalPlanForUi(subscriptionInfo.plan) !== 'trial' && <div className="subscription-active-notice" role="status">{locale === 'ar' ? 'لديك اشتراك مدفوع نشط حاليًا. يمكنك إرسال طلب تجديد أو تغيير، وسيتم اعتماد باقة واحدة فقط بعد مراجعة الطلب.' : 'You currently have one active paid subscription. You may submit a renewal or change request; only one package will remain active after approval.'}</div>}
        <RequestHistory requests={myRequests} t={t} locale={locale} />
        <div className="subscription-section-heading subscription-plans-heading"><div><span className="subscription-eyebrow">{t('flexiblePlans')}</span><h2>{t('choosePlan')}</h2><p>{t('plansDescription')}</p></div></div>
        <div className="subscription-plans-grid">
        {visiblePlans.map((plan) => {
          const price = priceFor(plan);
          const original = originalPriceFor(plan);
          const discount = discountPercent(original, price);
          const offerData = offerFor(plan);
          const hasOffer = Boolean(plan.has_offer || offerData?.id || offerData?.title || discount > 0);
          return <article key={plan.id} className={`subscription-plan-card ${plan.highlight ? 'is-highlighted' : ''} ${hasOffer ? 'has-offer' : ''} ${selectedPlan === plan.id ? 'is-selected' : ''}`}>
            {hasOffer && <div className="subscription-plan-offer-top"><span>{offerData?.title || plan.offer_title || t('specialOffer')}</span>{discount > 0 && <b>{discount}% {t('discount', 'خصم')}</b>}</div>}
            {plan.highlight && !hasOffer && <span className="subscription-plan-ribbon">{t('mostAttractive')}</span>}
            <div className="subscription-plan-card__heading"><span className="subscription-plan-index">{plan.id === 'yearly' ? '02' : plan.id === 'lifetime' ? '03' : '01'}</span><h3>{planLabel(plan, t)}</h3></div>
            <div className="subscription-plan-price-block">{hasOffer && <del>{omrWithEquivalent(original)}</del>}<strong>{price ? omrWithEquivalent(price) : '...'}</strong></div>
            {hasOffer && <p className="subscription-offer-description">{offerData?.description || plan.offer_description || t('specialOfferDescription', 'عرض محدود لفترة محدودة')}</p>}
            {plan.note && <p className="subscription-plan-note">{plan.note}</p>}
            {Array.isArray(plan.features) && plan.features.length > 0 && <ul className="subscription-plan-features">{plan.features.map((feature) => <li key={feature}><span>✓</span>{feature}</li>)}</ul>}
            <p className="subscription-plan-duration">{plan.duration_days === null || plan.duration_days === undefined ? t('unlimitedAccess') : t('planValidity', '', { days: plan.duration_days })}</p>
            <button className={hasOffer ? 'btn-offer' : 'btn-primary'} onClick={() => { setSubmitted(false); setSelectedPlan(plan.id); }}>{t('chooseThisPlan')}</button>
          </article>;
        })}
      </div>

      {selected && <section ref={activationRef} className="subscription-activation-card scroll-mt-6"><div className="subscription-activation-card__heading"><div><span className="subscription-eyebrow">{t('activationTitle')}</span><h3>{planLabel(selected, t)}</h3></div><strong>{omrWithEquivalent(priceFor(selected))}</strong></div><div className="subscription-payment-details"><div><span>{locale === 'ar' ? 'رقم التحويل' : 'Transfer number'}</span><strong>{payment.phone || phone}</strong></div>{payment.recipient && <div><span>{locale === 'ar' ? 'المستلم' : 'Recipient'}</span><strong>{payment.recipient}</strong></div>}{payment.method && <div><span>{locale === 'ar' ? 'طريقة الدفع' : 'Payment method'}</span><strong>{payment.method}</strong></div>}{payment.account && <div><span>{locale === 'ar' ? 'الحساب / IBAN' : 'Account / IBAN'}</span><strong>{payment.account}</strong></div>}</div><ol className="list-decimal list-inside text-sm text-ink/80 space-y-2 mb-5"><li>{t('activationStep1')} <span className="font-bold text-primary">{omrWithEquivalent(priceFor(selected))}</span> — <span className="font-bold">{payment.phone || phone}</span></li><li>{t('activationStep2')}</li><li>{t('activationStep3')}</li></ol>{(payment.note_ar || payment.note_en) && <p className="subscription-payment-note">{locale === 'ar' ? payment.note_ar || payment.note_en : payment.note_en || payment.note_ar}</p>}{submitted ? <p className="text-primary font-medium">{t('requestSent')}</p> : <form onSubmit={submitRequest} className="space-y-3"><div><label className="label">{t('transferReference')}</label><input className="input" value={referenceNote} onChange={(e) => setReferenceNote(e.target.value)} placeholder={locale === 'ar' ? 'مثال: تحويل باسم أحمد - 123456' : 'e.g. Transfer by Ahmed - 123456'} /></div><div><label className="label">{t('receiptOptional')}</label><input type="file" accept="image/*" onChange={handleReceipt} className="text-sm" />{receiptImage && <img src={receiptImage} alt={t('receiptOptional')} className="mt-2 max-h-40 rounded-lg border border-line" />}</div><div className="flex gap-2"><button className="btn-primary" disabled={busy} type="submit">{busy ? '...' : t('submitActivation')}</button><button className="btn-secondary" type="button" onClick={() => { setSelectedPlan(null); setRequestError(''); }}>{t('cancel')}</button></div>{requestError && <p className="subscription-form-error" role="alert">{requestError}</p>}</form>}</section>}
        <p className="subscription-footnote">{t('manualActivationNote')}</p>
      </main>
    </div>
  );
}

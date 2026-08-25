import React, { useEffect, useMemo, useRef, useState } from 'react';
import api, { getLocalFirst } from '../api/client';
import CompactPageHeader from '../components/CompactPageHeader.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { omrWithEquivalent } from '../constants.js';
import { resizeImageFile } from '../utils/image.js';
import { connectSocket, releaseSocket } from '../api/socket';
import { useLocale } from '../context/LocaleContext.jsx';
import { readAuthToken } from '../utils/localCache.js';
import { localizeApiError } from '../utils/apiError.js';

const FALLBACK_PLANS = [
  { id: '6_months', title: 'باقة 6 أشهر', base_price_omr: 4, price_omr: 4, original_price_omr: 4, duration_days: 182, included_students: 120, student_limit: 120, extra_student_price_omr: 0.1, note: 'وصول كامل لمدة نصف عام', features: ['دفتر درجات كامل', 'الحضور والسلوك', 'التحليلات والتقارير'] },
  { id: 'yearly', title: 'الباقة السنوية', highlight: true, base_price_omr: 7, price_omr: 7, original_price_omr: 7, duration_days: 365, included_students: 120, student_limit: 120, extra_student_price_omr: 0.1, note: 'الأكثر توفيرًا للعام الدراسي', features: ['كل أدوات EduCore', 'نسخ محلية ومزامنة', 'دعم فني مباشر'] },
  { id: 'lifetime', title: 'مدى الحياة', note: 'دفعة واحدة، وصول دائم', base_price_omr: 18, price_omr: 18, original_price_omr: 18, duration_days: null, included_students: 120, student_limit: 120, extra_student_price_omr: 0.1, features: ['وصول دائم', 'كل التحديثات المستقبلية', 'أولوية في الدعم'] },
];

function localizeDefaultPlan(plan, t) {
  const fallback = FALLBACK_PLANS.find((item) => item.id === plan?.id);
  if (!fallback) return plan;
  const copy = {
    '6_months': {
      title: 'planSixMonths', note: 'planSixMonthsNote',
      features: ['featureGradebook', 'featureAttendanceBehavior', 'featureAnalyticsReports'],
    },
    yearly: {
      title: 'planYearly', note: 'planYearlyNote',
      features: ['featureAllTools', 'featureLocalSync', 'featureSupport'],
    },
    lifetime: {
      title: 'planLifetime', note: 'planLifetimeNote',
      features: ['featureLifetime', 'featureFutureUpdates', 'featurePrioritySupport'],
    },
  }[plan.id];
  if (!copy) return plan;
  const defaultFeatures = fallback.features || [];
  const featuresMatch = Array.isArray(plan.features) && plan.features.length === defaultFeatures.length
    && plan.features.every((feature, index) => feature === defaultFeatures[index]);
  return {
    ...plan,
    ...(String(plan.title || '').trim() === String(fallback.title || '').trim() ? { title: t(copy.title) } : {}),
    ...(String(plan.note || '').trim() === String(fallback.note || '').trim() ? { note: t(copy.note) } : {}),
    ...(featuresMatch ? { features: copy.features.map((key) => t(key)) } : {}),
  };
}

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

function currentPlanTitle(planId, rawTitle, t) {
  const canonical = canonicalPlanForUi(planId);
  const title = String(rawTitle || '').trim();
  const fallback = FALLBACK_PLANS.find((item) => item.id === canonical);
  return !title || (fallback && title === fallback.title) ? planLabel(canonical, t) : title;
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
  const [detailsOpen, setDetailsOpen] = useState(true);
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
  const planTitle = currentPlanTitle(plan, subscriptionInfo.planTitle, t);
  const offerTitle = subscriptionInfo.offerTitle || subscriptionInfo.offer_title || null;

  return (
    <section className="subscription-current-card">
      <button type="button" className="subscription-disclosure-heading" onClick={() => setDetailsOpen((open) => !open)} aria-expanded={detailsOpen}>
        <span><span className="subscription-eyebrow">{t('currentAccount')}</span><strong>{t('currentSubscription')}</strong></span>
        <span className="subscription-disclosure-heading__actions"><span className={`subscription-status-badge ${expired ? 'is-expired' : subscriptionInfo.status === 'active' ? 'is-active' : 'is-pending'}`}>{currentStatusLabel}</span><b aria-hidden="true">{detailsOpen ? '−' : '+'}</b></span>
      </button>
      {detailsOpen && <div className="subscription-disclosure-content">
        <div className="subscription-current-identity">
          <div><span>{t('plan')}</span><strong>{planTitle}</strong></div>
          {offerTitle && <div><span>{t('offerLabel')}</span><strong>{offerTitle}</strong></div>}
          {subscriptionInfo.amount !== null && subscriptionInfo.amount !== undefined && <div><span>{t('paidAmount')}</span><strong>{omrWithEquivalent(subscriptionInfo.amount, locale)}</strong></div>}
        </div>
        <div className="subscription-details-grid">
          <div><p>{t('activatedAt')}</p><strong>{formatDate(startDate, locale)}</strong></div>
          <div><p>{t('expiresAt')}</p><strong>{isLifetime ? t('planLifetime') : formatDate(endDate, locale)}</strong></div>
          <div><p>{t('remaining')}</p><strong className={expired ? 'is-danger' : daysLeft !== null && daysLeft <= 4 ? 'is-warning' : 'is-good'}>{daysLeft === null ? (isLifetime ? t('unlimited') : isTrial ? t('trialPending') : '—') : expired ? t('statusExpired') : t('days', '', { count: daysLeft })}</strong></div>
          <div><p>{t('status')}</p><strong>{currentStatusLabel}</strong></div>
        </div>
        {subscriptionInfo.approvedAt && <p className="subscription-current-card__meta">{t('approvedAt')}: {formatDate(subscriptionInfo.approvedAt, locale, true)}</p>}
        {subscriptionInfo.status !== 'active' && !expired && <p className="subscription-current-card__note">{t('currentStatusNote', '', { status: currentStatusLabel })}</p>}
        {restrictions?.active && restrictions.blocked_features?.length > 0 && <div className="subscription-restrictions-note"><strong>{t('restrictionsTitle')}</strong><span>{t('restrictionsNotice')}</span><small>{restrictions.blocked_features.map((feature) => t({ students: 'featureStudents', gradebook: 'featureGradebook', behavior: 'featureBehavior', attendance: 'featureAttendance', analytics: 'featureAnalytics', reports: 'featureReports' }[feature] || feature)).join(' · ')}</small></div>}
      </div>}
    </section>
  );
}

export default function Subscription() {
  const { subscription, subscriptionInfo, refreshMe } = useAuth();
  const { t, locale } = useLocale();
  const [plans, setPlans] = useState([]);
  const [pricingQuotes, setPricingQuotes] = useState({});
  const [pricingStudentCount, setPricingStudentCount] = useState(null);
  const [studentCountInput, setStudentCountInput] = useState('');
  const studentCountDirtyRef = useRef(false);
  const [pricingLoading, setPricingLoading] = useState(true);
  const [pricingError, setPricingError] = useState('');
  const [phone, setPhone] = useState('');
  const [payment, setPayment] = useState({});
  const [trialDays, setTrialDays] = useState(14);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [referenceNote, setReferenceNote] = useState('');
  const [receiptImage, setReceiptImage] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [plansOpen, setPlansOpen] = useState(true);
  const [offersOpen, setOffersOpen] = useState(true);
  const activationRef = useRef(null);

  useEffect(() => {
    void refreshMe().catch(() => undefined);
  }, [refreshMe]);

  useEffect(() => {
    let active = true;
    const lastNetworkRefreshRef = { current: 0 };
    const canRefreshNetwork = () => {
      const now = Date.now();
      if (now - lastNetworkRefreshRef.current < 10_000) return false;
      lastNetworkRefreshRef.current = now;
      return true;
    };
    const applyPlansResponse = (data) => {
      if (!active || !data) return;
      setPlans((data.plans || []).map((plan) => localizeDefaultPlan({ ...(FALLBACK_PLANS.find((item) => item.id === plan.id) || {}), ...plan }, t)));
      setPhone(data.payment_phone || data.payment?.phone || '');
      setPayment(data.payment || {});
      setTrialDays(Number(data.trial_days || 14));
    };
    const loadPlans = async ({ force = false } = {}) => {
      try {
        const response = force ? await api.get('/auth/plans') : await getLocalFirst('/auth/plans');
        applyPlansResponse(response.data);
        // Keep local-first paint, but never leave the user on a stale offers list.
        if (!force && response.fromLocalCache) {
          void response.revalidatePromise?.then((freshResponse) => applyPlansResponse(freshResponse?.data));
        }
      } catch {
        if (active && !plans.length) setPlans(FALLBACK_PLANS.map((plan) => localizeDefaultPlan(plan, t)));
      }
    };
    const loadPricing = async () => {
      setPricingLoading(true);
      try {
        const { data } = await api.get('/auth/student-pricing');
        if (!active) return;
        const actualCount = Math.max(0, Math.floor(Number(data.student_count || 0)));
        setPricingStudentCount(actualCount);
        setStudentCountInput((current) => studentCountDirtyRef.current ? current : String(actualCount));
        setPricingQuotes(Object.fromEntries((data.quotes || []).map((quote) => [quote.plan_id, quote])));
        setPricingError('');
      } catch {
        if (active) setPricingError(t('pricingQuoteUnavailable'));
      } finally {
        if (active) setPricingLoading(false);
      }
    };
    void loadPlans();
    void loadPricing();
    const timer = window.setInterval(() => { void loadPlans(); void loadPricing(); }, 5 * 60 * 1000);
    const onFocus = () => { if (!canRefreshNetwork()) return; void loadPlans({ force: true }); void loadPricing(); };
    const onVisibility = () => { if (document.visibilityState === 'visible' && canRefreshNetwork()) { void loadPlans({ force: true }); void loadPricing(); } };
    const onSubscriptionConfigUpdated = () => { if (!canRefreshNetwork()) return; void loadPlans({ force: true }); void loadPricing(); };
    const onReconnect = () => { if (!canRefreshNetwork()) return; void loadPlans({ force: true }); void loadPricing(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    const socket = connectSocket(readAuthToken(), { onReconnect });
    socket.on('subscription_config_updated', onSubscriptionConfigUpdated);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      socket.off('subscription_config_updated', onSubscriptionConfigUpdated);
      releaseSocket(socket, { onReconnect });
    };
  }, [t, locale]);

  const visiblePlans = useMemo(() => (plans.length ? plans : FALLBACK_PLANS).map((plan) => localizeDefaultPlan(plan, t)), [plans, t]);
  const selected = useMemo(() => visiblePlans.find((plan) => plan.id === selectedPlan), [visiblePlans, selectedPlan]);

  useEffect(() => {
    if (selectedPlan) activationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedPlan]);

  const priceFor = (plan) => priceNumber(plan?.price_omr ?? plan?.offer_price_omr ?? plan?.base_price_omr);
  const originalPriceFor = (plan) => priceNumber(plan?.original_price_omr ?? plan?.offer?.original_price_omr ?? plan?.base_price_omr ?? priceFor(plan));
  const offerFor = (plan) => plan?.offer || (plan?.offer_id ? { id: plan.offer_id, title: plan.offer_title, description: plan.offer_description, original_price_omr: plan.original_price_omr, offer_price_omr: plan.price_omr, starts_at: plan.offer_starts_at, ends_at: plan.offer_ends_at } : null);
  const isOfferPlan = (plan) => {
    const offerData = offerFor(plan);
    return Boolean(plan.has_offer || offerData?.id || offerData?.title || discountPercent(originalPriceFor(plan), priceFor(plan)) > 0);
  };
  const activeStudentCount = Math.max(0, Math.ceil(Number(pricingStudentCount ?? subscriptionInfo?.studentCount ?? 0)));
  const includedStudentsFor = (plan) => Math.max(1, Number(plan?.student_limit ?? plan?.included_students ?? 120));
  const extraStudentPriceFor = (plan) => Math.max(0, priceNumber(plan?.extra_student_price_omr ?? 0.1));
  const enteredStudentCount = studentCountInput.trim() === '' ? null : Math.max(0, Math.floor(Number(studentCountInput)));
  const updateStudentCount = (event) => {
    const next = event.target.value;
    if (!/^\d*$/.test(next)) return;
    studentCountDirtyRef.current = true;
    setStudentCountInput(next);
  };
  const useActualStudentCount = () => {
    studentCountDirtyRef.current = false;
    setStudentCountInput(String(pricingStudentCount ?? 0));
  };
  const quoteFor = (plan) => {
    const serverQuote = pricingQuotes[plan?.id];
    if (!serverQuote) return null;
    const base = priceNumber(serverQuote.base_amount_omr ?? priceFor(plan));
    const original = priceNumber(serverQuote.original_base_amount_omr ?? originalPriceFor(plan));
    const included = Math.max(1, Number(serverQuote.included_students ?? includedStudentsFor(plan)));
    const unit = Math.max(0, priceNumber(serverQuote.extra_student_price_omr ?? extraStudentPriceFor(plan)));
    const actualStudentCount = Math.max(0, Math.floor(Number(serverQuote.student_count ?? activeStudentCount)));
    const studentCount = enteredStudentCount === null ? actualStudentCount : enteredStudentCount;
    const extra = Math.max(0, studentCount - included);
    const surcharge = Number((extra * unit).toFixed(3));
    const total = Number((base + surcharge).toFixed(3));
    const originalTotal = Number((original + surcharge).toFixed(3));
    return { base, original, included, unit, extra, surcharge, studentCount, actualStudentCount, isPreview: studentCount !== actualStudentCount, total, originalTotal };
  };
  const offerPlans = visiblePlans.filter(isOfferPlan);
  const regularPlans = visiblePlans.filter((plan) => !isOfferPlan(plan));
  const renderPlanCard = (plan) => {
    const quote = quoteFor(plan);
    const price = quote?.base ?? priceFor(plan);
    const original = quote?.original ?? originalPriceFor(plan);
    const discount = discountPercent(original, price);
    const offerData = offerFor(plan);
    const hasOffer = isOfferPlan(plan);
    return <article key={plan.id} className={`subscription-plan-card ${plan.highlight ? 'is-highlighted' : ''} ${hasOffer ? 'has-offer' : ''} ${selectedPlan === plan.id ? 'is-selected' : ''}`}>
      {hasOffer && <div className="subscription-plan-offer-top"><span>{offerData?.title || plan.offer_title || t('specialOffer')}</span>{discount > 0 && <b>{discount}% {t('discount')}</b>}</div>}
      {plan.highlight && !hasOffer && <span className="subscription-plan-ribbon">{t('mostAttractive')}</span>}
      <div className="subscription-plan-card__heading"><span className="subscription-plan-index">{plan.id === 'yearly' ? '02' : plan.id === 'lifetime' ? '03' : '01'}</span><h3>{planLabel(plan, t)}</h3></div>
      <div className="subscription-plan-price-block">{quote ? <>{hasOffer && <del>{omrWithEquivalent(quote.originalTotal, locale)}</del>}<strong>{omrWithEquivalent(quote.total, locale)}</strong></> : <span className="text-sm text-ink/60">{pricingLoading ? t('pricingQuoteLoading') : t('pricingQuoteUnavailable')}</span>}</div>
      {quote ? <div className="subscription-plan-student-pricing"><span>{t('studentCount')}: <strong>{quote.studentCount}</strong> / {quote.included}</span>{quote.extra > 0 ? <small>{t('extraStudents')}: {quote.extra} × {omrWithEquivalent(quote.unit, locale)} = <strong>{omrWithEquivalent(quote.surcharge, locale)}</strong></small> : <small>{t('includedStudents')}: {quote.included}</small>}</div> : <p className="subscription-plan-pricing-note">{pricingError || t('pricingQuoteLoading')}</p>}
      {hasOffer && <p className="subscription-offer-description">{offerData?.description || plan.offer_description || t('specialOfferDescription')}</p>}
      {plan.note && <p className="subscription-plan-note">{plan.note}</p>}
      <p className="subscription-plan-pricing-note">{t('pricingStudentNote')}</p>
      {Array.isArray(plan.features) && plan.features.length > 0 && <ul className="subscription-plan-features">{plan.features.map((feature) => <li key={feature}><span>✓</span>{feature}</li>)}</ul>}
      <p className="subscription-plan-duration">{plan.duration_days === null || plan.duration_days === undefined ? t('unlimitedAccess') : t('planValidity', '', { days: plan.duration_days })}</p>
      <button className={hasOffer ? 'btn-offer' : 'btn-primary'} disabled={!quote || pricingLoading} onClick={() => { setSubmitted(false); setSelectedPlan(plan.id); }}>{t('chooseThisPlan')}</button>
    </article>;
  };

  const handleReceipt = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setReceiptImage(await resizeImageFile(file, 500, 0.7));
  };

  const selectedQuote = selected ? quoteFor(selected) : null;

  const submitRequest = async (e) => {
    e.preventDefault();
    if (!selected) return;
    if (enteredStudentCount === null || !Number.isInteger(enteredStudentCount) || enteredStudentCount < 0) {
      setRequestError(t('studentCountRequired'));
      return;
    }
    setBusy(true);
    setRequestError('');
    try {
      await api.post('/auth/payment-requests', { plan: selected.id, offer_id: selected.offer?.id || null, student_count: enteredStudentCount, reference_note: referenceNote, receipt_image: receiptImage });
      setSubmitted(true);
      setSelectedPlan(null);
      setReferenceNote('');
      setReceiptImage('');
      await refreshMe({ force: true });
    } catch (error) {
      if (error.response?.data?.code === 'STUDENT_COUNT_MISMATCH') {
        const actual = Math.max(0, Math.floor(Number(error.response.data.actual_student_count || 0)));
        setPricingStudentCount(actual);
        studentCountDirtyRef.current = false;
        setStudentCountInput(String(actual));
        setRequestError(t('studentCountChanged', '', { count: actual }));
      } else {
        setRequestError(localizeApiError(error, t, locale, 'unableSubmitActivation'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="subscription-page-shell">
      <div className="subscription-page-fixed-header">
        <CompactPageHeader
          backTo="/"
          backLabel={t('backToDashboard')}
          backIcon={locale === 'ar' ? 'arrowRight' : 'arrowLeft'}
          eyebrow={t('subscriptionJourney')}
          title={t('subscription')}
          subtitle={t('subscriptionDescription')}
          className="compact-page-header--subscription"
        >
          <span className="compact-page-header__badge">{t('secureLocalNote')}</span>
          <div className="subscription-current-summary">
            <span>{t('currentStatus')}</span>
            <strong>{currentPlanTitle(subscriptionInfo?.plan || subscription?.plan, subscriptionInfo?.planTitle, t)}</strong>
            <small>{subscriptionInfo?.plan === 'trial' ? t('defaultTrial', '', { days: trialDays }) : statusLabel(subscriptionInfo?.status || subscription?.status, t)}</small>
          </div>
        </CompactPageHeader>
      </div>
      <main className="subscription-page-content">
        <SubscriptionDetailsCard />
        {subscriptionInfo?.status === 'active' && canonicalPlanForUi(subscriptionInfo.plan) !== 'trial' && <div className="subscription-active-notice" role="status">{t('activePaidNotice')}</div>}
        <section className="subscription-student-count-card" aria-live="polite">
          <div className="subscription-student-count-card__copy"><span className="subscription-eyebrow">{t('pricingStudentNote')}</span><strong>{t('teacherStudentTotal')}</strong><small>{t('studentCountSource')}</small></div>
          <label className="subscription-student-count-field"><span>{t('studentCountLabel')}</span><input className="input" type="number" min="0" inputMode="numeric" value={studentCountInput} onChange={updateStudentCount} disabled={pricingLoading} placeholder={pricingLoading ? '...' : '0'} /><small>{pricingLoading ? t('pricingQuoteLoading') : t('studentCountSource')}</small>{pricingStudentCount !== null && <small>{t('serverActualStudentCount', '', { count: pricingStudentCount })}</small>}<button type="button" className="subscription-student-count-reset" onClick={useActualStudentCount} disabled={pricingLoading}>{t('useActualStudentCount')}</button></label>
        </section>
        <section className="subscription-plan-chooser">
          <button type="button" className="subscription-disclosure-heading subscription-section-disclosure" onClick={() => setPlansOpen((open) => !open)} aria-expanded={plansOpen} aria-controls="subscription-plans-content">
            <span><span className="subscription-eyebrow">{t('flexiblePlans')}</span><strong>{t('choosePlan')}</strong><small>{t('plansDescription')}</small></span>
            <b aria-hidden="true">{plansOpen ? '−' : '+'}</b>
          </button>
          {plansOpen && <div id="subscription-plans-content" className="subscription-plan-groups">
            {offerPlans.length > 0 && <section className="subscription-offers-section">
              <button type="button" className="subscription-disclosure-heading subscription-offers-disclosure" onClick={() => setOffersOpen((open) => !open)} aria-expanded={offersOpen} aria-controls="subscription-offers-content">
                <span><span className="subscription-eyebrow">{t('specialOffer')}</span><strong>{t('offersSectionTitle')}</strong><small>{t('offersSectionDescription')}</small></span>
                <b aria-hidden="true">{offersOpen ? '−' : '+'}</b>
              </button>
              {offersOpen && <div id="subscription-offers-content" className="subscription-plans-grid subscription-offers-grid">{offerPlans.map(renderPlanCard)}</div>}
            </section>}
            {regularPlans.length > 0 && <div className="subscription-plans-grid subscription-standard-grid">{regularPlans.map(renderPlanCard)}</div>}
          </div>}
        </section>

      {selected && selectedQuote && <section ref={activationRef} className="subscription-activation-card scroll-mt-6"><div className="subscription-activation-card__heading"><div><span className="subscription-eyebrow">{t('activationTitle')}</span><h3>{planLabel(selected, t)}</h3></div><strong>{omrWithEquivalent(selectedQuote.total, locale)}</strong></div><div className="subscription-activation-quote"><span>{t('studentCount')}: {selectedQuote.studentCount ?? activeStudentCount} / {selectedQuote.included}</span><span>{t('basePrice')}: {omrWithEquivalent(selectedQuote.base, locale)}</span>{selectedQuote.extra > 0 && <span>{t('studentSurcharge')}: {selectedQuote.extra} × {omrWithEquivalent(selectedQuote.unit, locale)} = {omrWithEquivalent(selectedQuote.surcharge, locale)}</span>}<strong>{t('totalPrice')}: {omrWithEquivalent(selectedQuote.total, locale)}</strong></div><div className="subscription-payment-details"><div><span>{t('transferNumber')}</span><strong>{payment.phone || phone}</strong></div>{payment.recipient && <div><span>{t('recipient')}</span><strong>{payment.recipient}</strong></div>}{payment.method && <div><span>{t('paymentMethod')}</span><strong>{payment.method}</strong></div>}{payment.account && <div><span>{t('accountLabel')}</span><strong>{payment.account}</strong></div>}</div><ol className="list-decimal list-inside text-sm text-ink/80 space-y-2 mb-5"><li>{t('activationStep1')} <span className="font-bold text-primary">{omrWithEquivalent(selectedQuote?.total, locale)}</span> — <span className="font-bold">{payment.phone || phone}</span></li><li>{t('activationStep2')}</li><li>{t('activationStep3')}</li></ol>{(payment.note_ar || payment.note_en) && <p className="subscription-payment-note">{locale === 'ar' ? payment.note_ar || payment.note_en : payment.note_en || payment.note_ar}</p>}{submitted ? <p className="text-primary font-medium">{t('requestSent')}</p> : <form onSubmit={submitRequest} className="space-y-3"><div><label className="label">{t('transferReference')}</label><input className="input" value={referenceNote} onChange={(e) => setReferenceNote(e.target.value)} placeholder={t('referenceExample')} /></div><div><label className="label">{t('receiptOptional')}</label><input type="file" accept="image/*" onChange={handleReceipt} className="text-sm" />{receiptImage && <img src={receiptImage} alt={t('receiptOptional')} className="mt-2 max-h-40 rounded-lg border border-line" />}</div><div className="flex gap-2"><button className="btn-primary" disabled={busy} type="submit">{busy ? '...' : t('submitActivation')}</button><button className="btn-secondary" type="button" onClick={() => { setSelectedPlan(null); setRequestError(''); }}>{t('cancel')}</button></div>{requestError && <p className="subscription-form-error" role="alert">{requestError}</p>}</form>}</section>}
        <p className="subscription-footnote">{t('manualActivationNote')}</p>
      </main>
    </div>
  );
}

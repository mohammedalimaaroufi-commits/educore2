import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useLocale } from '../context/LocaleContext.jsx';

const SECTION_BY_PATH = {
  '/': { key: 'dashboard', title: 'لوحة التحكم', text: 'guideDashboard' },
  '/subscription': { key: 'subscription', title: 'إدارة الاشتراك', text: 'guideSubscription' },
  '/settings': { key: 'settings', title: 'الإعدادات', text: 'guideStudents' },
};

function sectionFor(pathname) {
  if (pathname.startsWith('/classes/')) return { key: 'class', title: 'مساحة الصف', text: 'guideStudents' };
  return SECTION_BY_PATH[pathname] || null;
}

export default function OnboardingTutorial() {
  const { pathname } = useLocation();
  const { t, locale } = useLocale();
  const section = useMemo(() => sectionFor(pathname), [pathname]);
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [steps, setSteps] = useState([]);

  useEffect(() => {
    if (!section) return;
    const key = `educore_tour_seen_${section.key}`;
    if (localStorage.getItem(key) === '1') return;
    const nextSteps = section.key === 'class'
      ? [
          { title: 'قائمة الطلاب', text: 'guideStudents' },
          { title: 'دفتر الدرجات', text: 'guideGrades' },
          { title: 'السلوك', text: 'guideBehavior' },
          { title: 'التحليلات', text: 'guideAnalytics' },
        ]
      : [{ title: section.title, text: section.text }, { title: 'الخطوة التالية', text: 'guideGrades' }];
    setSteps(nextSteps);
    setStep(0);
    setVisible(true);
  }, [section]);

  if (!visible || !section || steps.length === 0) return null;
  const current = steps[step];
  const finish = () => {
    localStorage.setItem(`educore_tour_seen_${section.key}`, '1');
    setVisible(false);
  };
  return <div className="tutorial-backdrop" role="dialog" aria-modal="true" aria-label={t('guideWelcome')} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
    <div className="tutorial-card">
      <div className="tutorial-card__accent" />
      <div className="tutorial-card__top"><span className="tutorial-badge">EduCore Guide</span><button type="button" className="tutorial-close" onClick={finish} aria-label={t('guideSkip')}>×</button></div>
      <p className="tutorial-eyebrow">{step === 0 ? t('guideWelcome') : section.title}</p>
      <h2>{step === 0 ? t('guideWelcome') : current.title}</h2>
      <p>{step === 0 ? t('guideWelcomeText') : t(current.text)}</p>
      <div className="tutorial-progress">{steps.map((_, index) => <span key={index} className={index <= step ? 'is-active' : ''} />)}</div>
      <div className="tutorial-actions"><button type="button" className="btn-secondary" onClick={finish}>{t('guideSkip')}</button><div className="flex gap-2">{step > 0 && <button type="button" className="btn-secondary" onClick={() => setStep((value) => value - 1)}>{t('guideBack')}</button>}<button type="button" className="btn-primary" onClick={() => step >= steps.length - 1 ? finish() : setStep((value) => value + 1)}>{step >= steps.length - 1 ? t('guideFinish') : t('guideNext')}</button></div></div>
    </div>
  </div>;
}

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { getLocalFirst, invalidateApiCache } from '../api/client';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
import { getTeacherId, readProfileDraft, removeProfileDraft, savePendingProfile, saveProfileDraft } from '../utils/localCache.js';
import { queueMutation } from '../utils/snapshotSync.js';
import { readSettingsCache, writeSettingsCache } from '../utils/settingsCache.js';
import SchemesManager from '../components/SchemesManager.jsx';
import BehaviorTemplateManager from '../components/BehaviorTemplateManager.jsx';
import BackupManager from '../components/BackupManager.jsx';
import LocalStorageManager from '../components/LocalStorageManager.jsx';
import { useConfirmDialog } from '../components/ConfirmDialog.jsx';
import { DEFAULT_FOLLOW_UP_SETTINGS, normalizeFollowUpSettings } from '../utils/analyticsSelectors.js';

const CATEGORIES = [
  { id: 'grade', key: 'grades' },
  { id: 'behavior', key: 'behavior' },
  { id: 'attendance', key: 'attendance' },
  { id: 'general', key: 'general' },
];

const TABS = [
  { id: 'profile', key: 'profile' },
  { id: 'schemes', key: 'schemes' },
  { id: 'behavior', key: 'behaviorTemplates' },
  { id: 'recommendations', key: 'finalRecommendations' },
  { id: 'follow-up', key: 'followUpRules', label: { ar: 'شروط المتابعة', en: 'Follow-up rules' } },
  { id: 'templates', key: 'gradeTemplates' },
  { id: 'backup', key: 'backup' },
];

function ProfileTab() {
  const { teacher, refreshMe, updateLocalTeacher } = useAuth();
  const { t, locale, changeLocale } = useLocale();
  const [profile, setProfile] = useState({ full_name: '', subject: '', school_stage: '', school_name: '', locale: 'ar' });
  const [savedMsg, setSavedMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!teacher) return;
    const serverProfile = {
      full_name: teacher.full_name || '',
      subject: teacher.subject || '',
      school_stage: teacher.school_stage || '',
      school_name: teacher.school_name || '',
      locale: teacher.locale || locale,
    };
    const localDraft = readProfileDraft(teacher.id);
    const draftMatchesServer = localDraft && JSON.stringify(localDraft) === JSON.stringify(serverProfile);
    if (draftMatchesServer) removeProfileDraft(teacher.id);
    setProfile(draftMatchesServer ? serverProfile : (localDraft || serverProfile));
    setDraftDirty(Boolean(localDraft && !draftMatchesServer));
  }, [teacher?.id, teacher?.full_name, teacher?.subject, teacher?.school_stage, teacher?.school_name, teacher?.locale, locale]);

  useEffect(() => {
    if (teacher?.id && draftDirty && profile.full_name) saveProfileDraft(teacher.id, profile);
  }, [teacher?.id, profile, draftDirty]);

  const updateProfileField = (field, value) => {
    setDraftDirty(true);
    setProfile((current) => ({ ...current, [field]: value }));
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    if (!teacher?.id || !profile.full_name.trim()) {
      setError(t('requiredFields'));
      return;
    }
    setSaving(true);
    setError('');
    setSavedMsg('');
    // Persist the complete draft before the network request so a refresh/offline transition cannot lose edits.
    saveProfileDraft(teacher.id, profile);
    updateLocalTeacher({ ...teacher, ...profile });
    try {
      const { data } = await api.patch('/settings/profile', profile);
      const savedTeacher = data?.teacher || { ...teacher, ...profile };
      updateLocalTeacher(savedTeacher);
      await invalidateApiCache('/auth/me');
      await refreshMe({ force: true });
      removeProfileDraft(teacher.id);
      setDraftDirty(false);
      setProfile({ full_name: savedTeacher.full_name || '', subject: savedTeacher.subject || '', school_stage: savedTeacher.school_stage || '', school_name: savedTeacher.school_name || '', locale: savedTeacher.locale || locale });
      setSavedMsg(t('saved'));
    } catch {
      savePendingProfile(teacher.id, profile);
      setSavedMsg(t('profileSavedOffline'));
      setError(t('serverUnavailable'));
    } finally {
      setSaving(false);
      setTimeout(() => setSavedMsg(''), 3500);
    }
  };

  return (
    <div className="settings-panel settings-panel--profile">
      <div className="settings-panel__heading"><div><span className="settings-eyebrow">{t('accountIdentity')}</span><h3>{t('profile')}</h3><p>{t('profileDescription')}</p></div><span className="settings-panel__icon">◎</span></div>
      <form onSubmit={saveProfile} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className="label">{t('fullName')}</label><input className="input" value={profile.full_name} onChange={(e) => updateProfileField('full_name', e.target.value)} /></div>
        <div><label className="label">{t('subject')}</label><input className="input" value={profile.subject} onChange={(e) => updateProfileField('subject', e.target.value)} /></div>
        <div><label className="label">{t('schoolStage')}</label><input className="input" value={profile.school_stage} onChange={(e) => updateProfileField('school_stage', e.target.value)} /></div>
        <div><label className="label">{t('schoolName')}</label><input className="input" value={profile.school_name} onChange={(e) => updateProfileField('school_name', e.target.value)} /></div>
        <div><label className="label">{t('language')}</label><select className="input" value={profile.locale || locale} onChange={(e) => { updateProfileField('locale', e.target.value); void changeLocale(e.target.value); }}><option value="ar">{t('arabic')}</option><option value="en">{t('english')}</option></select></div>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <button className="btn-primary" type="submit" disabled={saving}>{saving ? '...' : t('save')}</button>
          {savedMsg && <span className="text-primary text-sm">{savedMsg}</span>}
          {error && <span className="text-danger text-sm">{error}</span>}
        </div>
      </form>
    </div>
  );
}

function RecommendationsTab() {
  const { t } = useLocale();
  const { confirm, confirmDialog } = useConfirmDialog();
  const teacherId = getTeacherId();
  const [rules, setRules] = useState(() => readSettingsCache(teacherId, 'grade-recommendations', []));
  const [newRule, setNewRule] = useState({ min_score: '', max_score: '', text: '' });

  const persistRules = (next) => { setRules(next); writeSettingsCache(teacherId, 'grade-recommendations', next); };
  const loadRules = async () => {
    try {
      const { data } = await getLocalFirst('/settings/grade-recommendations');
      persistRules(data.rules || []);
    } catch {
      if (!rules.length) setRules([]);
    }
  };
  useEffect(() => { loadRules(); }, []);

  const addRule = async (e) => {
    e.preventDefault();
    const payload = { min_score: Number(newRule.min_score), max_score: Number(newRule.max_score), text: newRule.text };
    const optimistic = { id: `local-rule-${Date.now()}`, ...payload };
    persistRules([...rules, optimistic]);
    setNewRule({ min_score: '', max_score: '', text: '' });
    try {
      const { data } = await api.post('/settings/grade-recommendations', payload);
      persistRules([...rules, optimistic].map((item) => item.id === optimistic.id ? data.rule : item));
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: '/settings/grade-recommendations', data: payload });
    }
  };

  const updateRule = async (id, field, value) => {
    const next = rules.map((item) => item.id === id ? { ...item, [field]: value } : item);
    persistRules(next);
    try {
      const { data } = await api.patch(`/settings/grade-recommendations/${id}`, { [field]: value });
      persistRules(next.map((item) => item.id === id ? data.rule : item));
    } catch {
      if (!String(id).startsWith('local-')) await queueMutation(teacherId, { method: 'PATCH', url: `/settings/grade-recommendations/${id}`, data: { [field]: value } });
    }
  };

  const deleteRule = async (id) => {
    const accepted = await confirm({ title: t('deleteRule'), message: t('deleteRuleConfirm'), confirmLabel: t('delete'), cancelLabel: t('cancel'), danger: true });
    if (!accepted) return;
    const next = rules.filter((item) => item.id !== id);
    persistRules(next);
    try {
      if (!String(id).startsWith('local-')) await api.delete(`/settings/grade-recommendations/${id}`);
    } catch {
      await queueMutation(teacherId, { method: 'DELETE', url: `/settings/grade-recommendations/${id}` });
    }
  };

  return (
    <div className="card p-5">
      {confirmDialog}
      <h3 className="font-bold mb-1">{t('recommendationsTitle')}</h3>
      <p className="text-xs text-ink/60 mb-4">{t('recommendationsText')}</p>

      <div className="space-y-2 mb-4">
        {rules.sort((a, b) => b.min_score - a.min_score).map((r) => (
          <div key={r.id} className="grid gap-2 items-center" style={{ gridTemplateColumns: '70px 20px 70px 1fr 32px' }}>
            <input className="input text-xs py-1" type="number" defaultValue={r.min_score}
              onBlur={(e) => Number(e.target.value) !== r.min_score && updateRule(r.id, 'min_score', Number(e.target.value))} />
            <span className="text-center text-ink/40 text-xs">–</span>
            <input className="input text-xs py-1" type="number" defaultValue={r.max_score}
              onBlur={(e) => Number(e.target.value) !== r.max_score && updateRule(r.id, 'max_score', Number(e.target.value))} />
            <input className="input text-xs py-1" defaultValue={r.text}
              onBlur={(e) => e.target.value !== r.text && updateRule(r.id, 'text', e.target.value)} />
            <button className="text-danger text-xs" onClick={() => deleteRule(r.id)}>{t('deleteClass')}</button>
          </div>
        ))}
        {rules.length === 0 && <p className="text-ink/50 text-sm">{t('noRules')}</p>}
      </div>

      <form onSubmit={addRule} className="grid gap-2 items-center pt-2 border-t border-line" style={{ gridTemplateColumns: '70px 20px 70px 1fr auto' }}>
        <input className="input text-xs py-1" type="number" placeholder={t('from')} required
          value={newRule.min_score} onChange={(e) => setNewRule({ ...newRule, min_score: e.target.value })} />
        <span className="text-center text-ink/40 text-xs">–</span>
        <input className="input text-xs py-1" type="number" placeholder={t('to')} required
          value={newRule.max_score} onChange={(e) => setNewRule({ ...newRule, max_score: e.target.value })} />
        <input className="input text-xs py-1" placeholder={t('recommendationText')} required
          value={newRule.text} onChange={(e) => setNewRule({ ...newRule, text: e.target.value })} />
        <button className="btn-secondary text-xs px-2" type="submit">+ {t('add')}</button>
      </form>
    </div>
  );
}

function FollowUpRulesTab() {
  const { locale } = useLocale();
  const teacherId = getTeacherId();
  const [settings, setSettings] = useState(() => normalizeFollowUpSettings(readSettingsCache(teacherId, 'follow-up-rules', DEFAULT_FOLLOW_UP_SETTINGS)));
  const [saved, setSaved] = useState(false);
  const isArabic = locale === 'ar';
  const labels = isArabic ? {
    title: 'شروط الطلاب الذين يحتاجون متابعة',
    description: 'حدّد متى يظهر الطالب في بطاقة «يحتاجون متابعة» داخل التحليلات والتقارير. تحفظ التعديلات محليًا على جهازك وتطبق فورًا.',
    enabled: 'تفعيل الشرط',
    threshold: 'القيمة المحددة',
    behavior: 'السلوك السلبي',
    behaviorHelp: 'يظهر الطالب عندما يكون صافي نقاط السلوك مساويًا أو أقل من القيمة.',
    grade: 'إجمالي الدرجة',
    gradeHelp: 'يظهر الطالب عندما تكون الدرجة النهائية أقل من النسبة المحددة.',
    missingGrade: 'درجة غير مكتملة',
    missingGradeHelp: 'يظهر الطالب الذي لم تكتمل له درجة نهائية بعد.',
    absence: 'أيام الغياب',
    absenceHelp: 'يظهر الطالب عند بلوغ عدد أيام الغياب أو تجاوزه.',
    late: 'أيام التأخير',
    lateHelp: 'يظهر الطالب عند بلوغ عدد مرات التأخير أو تجاوزه.',
    saved: 'تم حفظ شروط المتابعة على الجهاز',
    reset: 'إعادة القيم الافتراضية',
    points: 'نقطة',
    percent: '%',
    days: 'يومًا',
  } : {
    title: 'Students who need follow-up',
    description: 'Choose when a student appears in the Follow-up card in analytics and reports. Changes are saved locally and apply immediately.',
    enabled: 'Enable rule',
    threshold: 'Threshold',
    behavior: 'Negative behavior',
    behaviorHelp: 'Shows a student when net behavior points are equal to or below this value.',
    grade: 'Overall grade',
    gradeHelp: 'Shows a student when the final grade is below this percentage.',
    missingGrade: 'Incomplete grade',
    missingGradeHelp: 'Shows a student with no completed final grade.',
    absence: 'Absence days',
    absenceHelp: 'Shows a student when absence days reach this value.',
    late: 'Late days',
    lateHelp: 'Shows a student when late records reach this value.',
    saved: 'Follow-up rules saved on this device',
    reset: 'Reset defaults',
    points: 'points',
    percent: '%',
    days: 'days',
  };
  const persist = (next) => {
    const normalized = normalizeFollowUpSettings(next);
    setSettings(normalized);
    writeSettingsCache(teacherId, 'follow-up-rules', normalized);
    setSaved(true);
    window.dispatchEvent(new CustomEvent('educore-follow-up-rules-updated'));
    window.setTimeout(() => setSaved(false), 2200);
  };
  const updateEnabled = (key, value) => persist({ ...settings, enabled: { ...settings.enabled, [key]: value } });
  const updateThreshold = (key, value) => persist({ ...settings, thresholds: { ...settings.thresholds, [key]: value } });
  const ruleRows = [
    { key: 'behavior', label: labels.behavior, help: labels.behaviorHelp, input: 'behaviorScore', suffix: labels.points },
    { key: 'grade', label: labels.grade, help: labels.gradeHelp, input: 'finalGrade', suffix: labels.percent },
    { key: 'missingGrade', label: labels.missingGrade, help: labels.missingGradeHelp, input: null, suffix: '' },
    { key: 'absence', label: labels.absence, help: labels.absenceHelp, input: 'absentDays', suffix: labels.days },
    { key: 'late', label: labels.late, help: labels.lateHelp, input: 'lateDays', suffix: labels.days },
  ];
  return <div className="card p-5 settings-follow-up-rules">
    <div className="settings-panel__heading"><div><span className="settings-eyebrow">{isArabic ? 'تنبيهات ذكية' : 'Smart alerts'}</span><h3>{labels.title}</h3><p>{labels.description}</p></div><span className="settings-panel__icon">!</span></div>
    <div className="space-y-2">
      {ruleRows.map((rule) => <div key={rule.key} className="settings-follow-up-rule"><label className="flex items-start gap-3 flex-1 cursor-pointer"><input type="checkbox" checked={Boolean(settings.enabled[rule.key])} onChange={(event) => updateEnabled(rule.key, event.target.checked)} /><span><strong className="block text-sm">{rule.label}</strong><small className="block text-xs text-ink/55 mt-1">{rule.help}</small></span></label>{rule.input && <div className="flex items-center gap-1"><span className="text-[11px] text-ink/45">{labels.threshold}</span><input className="input text-sm w-24 text-center" type="number" step="any" value={settings.thresholds[rule.input]} onChange={(event) => updateThreshold(rule.input, event.target.value)} aria-label={rule.label} /><span className="text-xs text-ink/45">{rule.suffix}</span></div>}</div>)}
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3"><button type="button" className="btn-secondary text-xs" onClick={() => persist(DEFAULT_FOLLOW_UP_SETTINGS)}>{labels.reset}</button>{saved && <span className="text-primary text-xs">{labels.saved}</span>}</div>
  </div>;
}

function TemplatesTab() {
  const { t } = useLocale();
  const teacherId = getTeacherId();
  const [templates, setTemplates] = useState(() => readSettingsCache(teacherId, 'comment-templates', []));
  const [newTemplate, setNewTemplate] = useState({ text: '', category: 'grade' });

  const persistTemplates = (next) => { setTemplates(next); writeSettingsCache(teacherId, 'comment-templates', next); };
  const loadTemplates = async () => {
    try {
      const { data } = await getLocalFirst('/settings/comment-templates');
      persistTemplates(data.templates || []);
    } catch {
      if (!templates.length) setTemplates([]);
    }
  };
  useEffect(() => { loadTemplates(); }, []);

  const addTemplate = async (e) => {
    e.preventDefault();
    const payload = { ...newTemplate };
    const optimistic = { id: `local-template-${Date.now()}`, ...payload };
    persistTemplates([...templates, optimistic]);
    setNewTemplate({ text: '', category: 'grade' });
    try {
      const { data } = await api.post('/settings/comment-templates', payload);
      persistTemplates([...templates, optimistic].map((item) => item.id === optimistic.id ? data.template : item));
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: '/settings/comment-templates', data: payload });
    }
  };

  const deleteTemplate = async (id) => {
    const next = templates.filter((item) => item.id !== id);
    persistTemplates(next);
    try {
      if (!String(id).startsWith('local-')) await api.delete(`/settings/comment-templates/${id}`);
    } catch {
      await queueMutation(teacherId, { method: 'DELETE', url: `/settings/comment-templates/${id}` });
    }
  };

  return (
    <div className="card p-5">
      <h3 className="font-bold mb-1">{t('phraseBankTitle')}</h3>
      <p className="text-xs text-ink/60 mb-4">{t('phraseBankText')}</p>

      <form onSubmit={addTemplate} className="flex flex-wrap gap-2 mb-5">
        <select className="input text-sm w-32" value={newTemplate.category} onChange={(e) => setNewTemplate({ ...newTemplate, category: e.target.value })}>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{t(c.key)}</option>)}
        </select>
        <input className="input text-sm flex-1 min-w-[200px]" placeholder={t('phraseText')} required
          value={newTemplate.text} onChange={(e) => setNewTemplate({ ...newTemplate, text: e.target.value })} />
        <button className="btn-primary text-sm" type="submit">+ {t('add')}</button>
      </form>

      <div className="space-y-4">
        {CATEGORIES.map((cat) => {
          const items = templates.filter((t) => t.category === cat.id);
          if (items.length === 0) return null;
          return (
            <div key={cat.id}>
              <p className="text-xs font-bold text-ink/50 mb-2">{t(cat.key)}</p>
              <div className="space-y-1">
                {items.map((phrase) => (
                  <div key={phrase.id} className="flex items-center justify-between text-sm border-b border-line pb-1">
                    <span>{phrase.text}</span>
                    <button className="text-danger text-xs" onClick={() => deleteTemplate(phrase.id)}>{t('deleteClass')}</button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {templates.length === 0 && <p className="text-ink/50 text-sm">{t('noPhrases')}</p>}
      </div>
    </div>
  );
}

export default function Settings() {
  const { t, locale } = useLocale();
  const [tab, setTab] = useState('profile');

  return (
    <div className="settings-page-shell">
      <div className="settings-page-fixed-header">
        <div className="settings-page-topline"><Link to="/" className="settings-back">{locale === 'ar' ? '← العودة للوحة التحكم' : '← Back to dashboard'}</Link><span className="settings-local-badge">{t('localAutoSync')}</span></div>
        <header className="settings-page-hero"><div><span className="settings-eyebrow">{t('settingsCustomization')}</span><h1>{t('generalSettings')}</h1><p>{t('settingsDescription')}</p></div><div className="settings-hero-grid"><span>01<small>{t('profile')}</small></span><span>02<small>{t('gradeTemplates')}</small></span><span>03<small>{t('backup')}</small></span></div></header>
        <nav className="settings-tabs" aria-label={t('settings')}>
          {TABS.map((tabItem) => (
            <button key={tabItem.id} type="button" onClick={() => setTab(tabItem.id)}
              className={`settings-tab ${tab === tabItem.id ? 'is-active' : ''}`}>
              <span>{String(TABS.findIndex((item) => item.id === tabItem.id) + 1).padStart(2, '0')}</span>{tabItem.label?.[locale] || t(tabItem.key)}
            </button>
          ))}
        </nav>
      </div>
      <main className="settings-page-content">
        {tab === 'profile' && <ProfileTab />}
        {tab === 'schemes' && <SchemesManager />}
        {tab === 'behavior' && <BehaviorTemplateManager />}
      {tab === 'recommendations' && <RecommendationsTab />}
      {tab === 'follow-up' && <FollowUpRulesTab />}
      {tab === 'templates' && <TemplatesTab />}
        {tab === 'backup' && (
          <>
            <BackupManager />
            <LocalStorageManager />
          </>
        )}
      </main>
    </div>
  );
}

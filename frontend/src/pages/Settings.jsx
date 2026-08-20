import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { invalidateApiCache } from '../api/client';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
import { readProfileDraft, removeProfileDraft, savePendingProfile, saveProfileDraft } from '../utils/localCache.js';
import SchemesManager from '../components/SchemesManager.jsx';
import BehaviorTemplateManager from '../components/BehaviorTemplateManager.jsx';
import BackupManager from '../components/BackupManager.jsx';
import LocalStorageManager from '../components/LocalStorageManager.jsx';

const CATEGORIES = [
  { id: 'grade', label: 'الدرجات' },
  { id: 'behavior', label: 'السلوك' },
  { id: 'attendance', label: 'الحضور' },
  { id: 'general', label: 'عام' },
];

const TABS = [
  { id: 'profile', label: 'الملف الشخصي' },
  { id: 'schemes', label: 'فئات التقييم ومخططاتها الجاهزة' },
  { id: 'behavior', label: 'تحرير السلوك المخصص' },
  { id: 'recommendations', label: 'العبارات الوصفية للنتيجة النهائية' },
  { id: 'templates', label: 'العبارات الوصفية للدرجات' },
  { id: 'backup', label: 'نسخة احتياطية' },
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
  }, [teacher, locale]);

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
      removeProfileDraft(teacher.id);
      setDraftDirty(false);
      setProfile({ full_name: savedTeacher.full_name || '', subject: savedTeacher.subject || '', school_stage: savedTeacher.school_stage || '', school_name: savedTeacher.school_name || '', locale: savedTeacher.locale || locale });
      setSavedMsg(t('saved'));
    } catch {
      savePendingProfile(teacher.id, profile);
      setSavedMsg('تم حفظ التغييرات على هذا الجهاز، وستتم المزامنة عند عودة الاتصال');
      setError('تعذر الاتصال بالخادم حاليًا. بياناتك المحلية محفوظة ولن تضيع.');
    } finally {
      setSaving(false);
      setTimeout(() => setSavedMsg(''), 3500);
    }
  };

  return (
    <div className="settings-panel settings-panel--profile">
      <div className="settings-panel__heading"><div><span className="settings-eyebrow">هوية الحساب</span><h3>{t('profile')}</h3><p>عدّل بياناتك العامة وستُحفظ محليًا ثم تُزامن عند توفر الاتصال.</p></div><span className="settings-panel__icon">◎</span></div>
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
  const [rules, setRules] = useState([]);
  const [newRule, setNewRule] = useState({ min_score: '', max_score: '', text: '' });

  const loadRules = async () => {
    const { data } = await api.get('/settings/grade-recommendations');
    setRules(data.rules);
  };
  useEffect(() => { loadRules(); }, []);

  const addRule = async (e) => {
    e.preventDefault();
    await api.post('/settings/grade-recommendations', {
      min_score: Number(newRule.min_score), max_score: Number(newRule.max_score), text: newRule.text,
    });
    setNewRule({ min_score: '', max_score: '', text: '' });
    loadRules();
  };

  const updateRule = async (id, field, value) => {
    await api.patch(`/settings/grade-recommendations/${id}`, { [field]: value });
    loadRules();
  };

  const deleteRule = async (id) => {
    if (!confirm('حذف هذه القاعدة؟')) return;
    await api.delete(`/settings/grade-recommendations/${id}`);
    loadRules();
  };

  return (
    <div className="card p-5">
      <h3 className="font-bold mb-1">التوصيات التلقائية حسب الدرجة النهائية</h3>
      <p className="text-xs text-ink/60 mb-4">
        تُستخدم هذه القواعد لتوليد عبارة تلقائية في تقرير كل طالب، تُختار حسب مدى الدرجة النهائية. عدّل النطاقات أو النص كما يناسبك.
      </p>

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
            <button className="text-danger text-xs" onClick={() => deleteRule(r.id)}>حذف</button>
          </div>
        ))}
        {rules.length === 0 && <p className="text-ink/50 text-sm">لا توجد قواعد بعد.</p>}
      </div>

      <form onSubmit={addRule} className="grid gap-2 items-center pt-2 border-t border-line" style={{ gridTemplateColumns: '70px 20px 70px 1fr auto' }}>
        <input className="input text-xs py-1" type="number" placeholder="من" required
          value={newRule.min_score} onChange={(e) => setNewRule({ ...newRule, min_score: e.target.value })} />
        <span className="text-center text-ink/40 text-xs">–</span>
        <input className="input text-xs py-1" type="number" placeholder="إلى" required
          value={newRule.max_score} onChange={(e) => setNewRule({ ...newRule, max_score: e.target.value })} />
        <input className="input text-xs py-1" placeholder="نص التوصية" required
          value={newRule.text} onChange={(e) => setNewRule({ ...newRule, text: e.target.value })} />
        <button className="btn-secondary text-xs px-2" type="submit">+ إضافة</button>
      </form>
    </div>
  );
}

function TemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [newTemplate, setNewTemplate] = useState({ text: '', category: 'grade' });

  const loadTemplates = async () => {
    const { data } = await api.get('/settings/comment-templates');
    setTemplates(data.templates);
  };
  useEffect(() => { loadTemplates(); }, []);

  const addTemplate = async (e) => {
    e.preventDefault();
    await api.post('/settings/comment-templates', newTemplate);
    setNewTemplate({ text: '', category: 'grade' });
    loadTemplates();
  };

  const deleteTemplate = async (id) => {
    await api.delete(`/settings/comment-templates/${id}`);
    loadTemplates();
  };

  return (
    <div className="card p-5">
      <h3 className="font-bold mb-1">بنك العبارات الوصفية الجاهزة</h3>
      <p className="text-xs text-ink/60 mb-4">عبارات يمكن إدراجها بسرعة عند إدخال الدرجات أو كتابة التقارير، بدل كتابتها يدويًا كل مرة.</p>

      <form onSubmit={addTemplate} className="flex flex-wrap gap-2 mb-5">
        <select className="input text-sm w-32" value={newTemplate.category} onChange={(e) => setNewTemplate({ ...newTemplate, category: e.target.value })}>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <input className="input text-sm flex-1 min-w-[200px]" placeholder="نص العبارة" required
          value={newTemplate.text} onChange={(e) => setNewTemplate({ ...newTemplate, text: e.target.value })} />
        <button className="btn-primary text-sm" type="submit">+ إضافة</button>
      </form>

      <div className="space-y-4">
        {CATEGORIES.map((cat) => {
          const items = templates.filter((t) => t.category === cat.id);
          if (items.length === 0) return null;
          return (
            <div key={cat.id}>
              <p className="text-xs font-bold text-ink/50 mb-2">{cat.label}</p>
              <div className="space-y-1">
                {items.map((t) => (
                  <div key={t.id} className="flex items-center justify-between text-sm border-b border-line pb-1">
                    <span>{t.text}</span>
                    <button className="text-danger text-xs" onClick={() => deleteTemplate(t.id)}>حذف</button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {templates.length === 0 && <p className="text-ink/50 text-sm">لا توجد عبارات محفوظة بعد.</p>}
      </div>
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState('profile');

  return (
    <div className="settings-page-shell">
      <div className="settings-page-topline"><Link to="/" className="settings-back">← العودة للوحة التحكم</Link><span className="settings-local-badge">يحفظ محليًا · يزامن تلقائيًا</span></div>
      <header className="settings-page-hero"><div><span className="settings-eyebrow">مساحة التخصيص</span><h1>الإعدادات العامة</h1><p>اجعل EduCore يعمل بالطريقة التي تناسبك، من ملفك الشخصي إلى قوالب الدرجات والسلوك والنسخ الاحتياطية.</p></div><div className="settings-hero-grid"><span>01<small>الملف</small></span><span>02<small>القوالب</small></span><span>03<small>الحماية</small></span></div></header>

      <nav className="settings-tabs" aria-label="إعدادات المعلم">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`settings-tab ${tab === t.id ? 'is-active' : ''}`}>
            <span>{String(TABS.findIndex((item) => item.id === t.id) + 1).padStart(2, '0')}</span>{t.label}
          </button>
        ))}
      </nav>

      {tab === 'profile' && <ProfileTab />}
      {tab === 'schemes' && <SchemesManager />}
      {tab === 'behavior' && <BehaviorTemplateManager />}
      {tab === 'recommendations' && <RecommendationsTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'backup' && (
        <>
          <BackupManager />
          <LocalStorageManager />
        </>
      )}
    </div>
  );
}

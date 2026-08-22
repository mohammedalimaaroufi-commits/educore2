import React, { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { getTeacherId } from '../utils/localCache.js';
import { getOrSyncSnapshot, queueMutation, syncSnapshot } from '../utils/snapshotSync.js';
import { getClassData } from '../utils/analyticsSelectors.js';
import { saveSnapshot } from '../utils/localDb.js';
import { readSettingsCache, writeSettingsCache } from '../utils/settingsCache.js';
import { useLocale } from '../context/LocaleContext.jsx';
import { useConfirmDialog } from './ConfirmDialog.jsx';

function categorySignature(items = []) {
  return items.map((item) => `${String(item.name || '').trim().toLowerCase()}::${Number(item.weight_percent || 0).toFixed(4)}`).join('|');
}

const localCategoryId = () => `local-category-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export default function CategoryManager({ classId, refreshKey, onChange }) {
  const { t } = useLocale();
  const { confirm, confirmDialog } = useConfirmDialog();
  const teacherId = getTeacherId();
  const [categories, setCategories] = useState([]);
  const [totalWeight, setTotalWeight] = useState(0);
  const [newCat, setNewCat] = useState({ name: '', weight_percent: 0 });
  const [saveAsName, setSaveAsName] = useState('');
  const [savedId, setSavedId] = useState(null);
  const [savedScheme, setSavedScheme] = useState(false);
  const [schemes, setSchemes] = useState(() => readSettingsCache(teacherId, 'grading-schemes', []));
  const [selectedSchemeId, setSelectedSchemeId] = useState('');
  const [classAssignment, setClassAssignment] = useState(null);
  const [applyMode, setApplyMode] = useState('replace');
  const [applyingScheme, setApplyingScheme] = useState(false);
  const [feedback, setFeedback] = useState('');

  const persistSchemes = (next) => {
    setSchemes(next);
    writeSettingsCache(teacherId, 'grading-schemes', next);
  };

  const load = async () => {
    try {
      const { data } = await api.get('/grades/categories', { params: { class_id: classId } });
      const next = data.categories || [];
      setCategories(next);
      setTotalWeight(Number(data.totalWeight || next.reduce((sum, item) => sum + Number(item.weight_percent || 0), 0)));
    } catch {
      const local = await getOrSyncSnapshot(teacherId);
      const classData = getClassData(local, classId);
      const next = classData.categories || [];
      setCategories(next);
      setTotalWeight(next.reduce((sum, item) => sum + Number(item.weight_percent || 0), 0));
      setFeedback(t('offline'));
    }
    try {
      const { data } = await api.get('/schemes');
      persistSchemes(data.schemes || []);
    } catch {
      // Cached schemes remain available while offline.
    }
    try {
      const { data } = await api.get('/schemes/assignments');
      const assignment = data.assignments?.[classId] || null;
      setClassAssignment(assignment);
      if (assignment?.scheme_id) setSelectedSchemeId(String(assignment.scheme_id));
    } catch {
      // The locally selected scheme remains usable when the assignment endpoint is offline.
    }
  };

  useEffect(() => { void load().catch(() => setFeedback(t('serverUnavailable'))); }, [classId, refreshKey]);

  const currentScheme = useMemo(() => {
    const current = categorySignature(categories);
    return schemes.find((scheme) => categorySignature(scheme.categories || []) === current) || null;
  }, [categories, schemes]);
  const displayedSchemeName = currentScheme?.name || classAssignment?.scheme_name || null;

  const refreshLocalSnapshot = async () => {
    if (teacherId) await syncSnapshot(teacherId, { force: true });
  };

  const addCategory = async (event) => {
    event.preventDefault();
    if (!newCat.name.trim() || Number(newCat.weight_percent) < 0) return;
    await api.post('/grades/categories', {
      class_id: classId,
      name: newCat.name.trim(),
      weight_percent: Number(newCat.weight_percent || 0),
    });
    await refreshLocalSnapshot();
    setNewCat({ name: '', weight_percent: 0 });
    await load();
    onChange?.();
  };

  const updateCategory = async (id, patch) => {
    await api.patch(`/grades/categories/${id}`, patch);
    await refreshLocalSnapshot();
    setSavedId(id);
    setTimeout(() => setSavedId(null), 1200);
    await load();
    onChange?.();
  };

  const deleteCategory = async (id) => {
    const accepted = await confirm({ title: t('deleteCategory'), message: t('deleteCategoryConfirm'), confirmLabel: t('delete'), cancelLabel: t('cancel'), danger: true });
    if (!accepted) return;
    await api.delete(`/grades/categories/${id}`);
    await refreshLocalSnapshot();
    await load();
    onChange?.();
  };

  const saveCurrentAsScheme = async (event) => {
    event.preventDefault();
    if (!saveAsName.trim()) return;
    try {
      const { data } = await api.post('/schemes/from-class', { class_id: classId, name: saveAsName.trim() });
      const saved = data.scheme || data;
      if (saved?.id) persistSchemes([saved, ...schemes]);
      setSaveAsName('');
      setSavedScheme(true);
      setFeedback(t('savedAndSynced'));
      setTimeout(() => setSavedScheme(false), 1800);
    } catch {
      const localScheme = { id: `local-scheme-${Date.now()}`, name: saveAsName.trim(), categories: categories.map((category) => ({ name: category.name, weight_percent: Number(category.weight_percent || 0), grading_type: category.grading_type || 'numeric' })), is_default: 0 };
      persistSchemes([localScheme, ...schemes]);
      await queueMutation(teacherId, { method: 'POST', url: '/schemes/from-class', data: { class_id: classId, name: saveAsName.trim() } });
      setSaveAsName('');
      setSavedScheme(true);
      setFeedback(t('savedLocally'));
      setTimeout(() => setSavedScheme(false), 1800);
    }
  };

  const applySchemeLocally = async (scheme, replace) => {
    const incoming = (scheme.categories || []).map((item, index) => ({
      id: localCategoryId(),
      class_id: classId,
      name: item.name,
      weight_percent: Number(item.weight_percent || 0),
      grading_type: item.grading_type || 'numeric',
      grading_mode: 'direct',
      details_note: null,
      sort_order: index,
    }));
    const incomingAssessments = incoming.map((category) => ({
      id: localCategoryId(), category_id: category.id, title: category.name,
      max_score: category.weight_percent, is_summary: 1, date: null, created_at: new Date().toISOString(),
    }));
    const withAssessments = incoming.map((category) => ({ ...category, assessments: incomingAssessments.filter((assessment) => assessment.category_id === category.id) }));
    const oldIds = new Set(categories.map((item) => item.id));
    const next = replace ? withAssessments : [...categories, ...withAssessments.map((item, index) => ({ ...item, sort_order: categories.length + index }))];
    setCategories(next);
    setTotalWeight(next.reduce((sum, item) => sum + Number(item.weight_percent || 0), 0));
    const local = await getOrSyncSnapshot(teacherId);
    if (local) {
      const nextSnapshot = {
        ...local,
        grade_categories: replace
          ? [...(local.grade_categories || []).filter((item) => item.class_id !== classId), ...incoming]
          : [...(local.grade_categories || []), ...incoming],
        assessments: replace
          ? [...(local.assessments || []).filter((assessment) => !oldIds.has(assessment.category_id)), ...incomingAssessments]
          : [...(local.assessments || []), ...incomingAssessments],
      };
      await saveSnapshot(teacherId, nextSnapshot);
    }
  };

  const applyScheme = async () => {
    const scheme = schemes.find((item) => String(item.id) === String(selectedSchemeId));
    if (!scheme) {
      setFeedback(t('noSchemeSelected'));
      return;
    }
    const replace = applyMode === 'replace';
    const accepted = await confirm({ title: t('applySavedScheme'), message: t(replace ? 'replaceSchemeConfirm' : 'appendSchemeConfirm'), confirmLabel: t('apply'), cancelLabel: t('cancel'), danger: false });
    if (!accepted) return;
    setApplyingScheme(true);
    try {
      await api.post(`/schemes/${scheme.id}/apply`, { class_id: classId, replace });
      await refreshLocalSnapshot();
      setFeedback(t('schemeApplied'));
      await load();
      onChange?.();
    } catch {
      await applySchemeLocally(scheme, replace);
      await queueMutation(teacherId, { method: 'POST', url: `/schemes/${scheme.id}/apply`, data: { class_id: classId, replace } });
      setFeedback(t('schemeQueued'));
      onChange?.();
    } finally {
      setApplyingScheme(false);
    }
  };

  return (
    <div className="card p-5">
      {confirmDialog}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-bold text-lg">{t('gradeCategories')}</h3>
          <p className="text-xs text-ink/50 mt-1">{t('categoryManagerDescription')}</p>
        </div>
        <span className={`text-sm font-medium px-3 py-1 rounded-full ${Math.round(totalWeight) === 100 ? 'bg-primary/10 text-primary' : 'bg-danger/10 text-danger'}`}>
          {t('totalWeight')}: {totalWeight}% {Math.round(totalWeight) === 100 ? `✓ ${t('balanced')}` : `(${t('preferredHundred')})`}
        </span>
      </div>

      <section className="grading-scheme-toolbar mb-4 p-3 rounded-lg bg-surface border border-line" aria-label={t('applySavedScheme')}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div>
            <h4 className="font-bold text-sm">{t('applySavedScheme')}</h4>
            <p className="text-xs text-ink/50 mt-1">{displayedSchemeName ? `${t('currentClassScheme')}: ${displayedSchemeName}` : t('noCurrentClassScheme')}</p>
          </div>
          <span className="text-xs text-ink/50">{t('savedGradeSchemes')}: {schemes.length}</span>
        </div>
        <div className="grading-scheme-controls grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 items-center">
          <select className="input text-sm min-w-0" value={selectedSchemeId} onChange={(event) => setSelectedSchemeId(event.target.value)} aria-label={t('selectSavedScheme')}>
            <option value="">{t('selectSavedScheme')}</option>
            {schemes.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.name} · {(scheme.categories || []).length} {t('categoryCountShort')}</option>)}
          </select>
          <select className="input text-sm" value={applyMode} onChange={(event) => setApplyMode(event.target.value)} aria-label={t('applyMode')}>
            <option value="replace">{t('replaceScheme')}</option>
            <option value="append">{t('appendScheme')}</option>
          </select>
          <button className="btn-primary text-sm whitespace-nowrap" type="button" onClick={applyScheme} disabled={applyingScheme || !schemes.length}>{applyingScheme ? t('saving') : t('applyScheme')}</button>
        </div>
        {feedback && <p className="text-primary text-xs mt-2" role="status">{feedback}</p>}
      </section>

      <form onSubmit={saveCurrentAsScheme} className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-lg bg-surface border border-line">
        <span className="text-sm font-medium">{t('saveClassAsScheme')}</span>
        <input className="input text-sm flex-1 min-w-[190px]" placeholder={t('schemeNamePlaceholder')} value={saveAsName} onChange={(event) => setSaveAsName(event.target.value)} required />
        <button className="btn-secondary text-sm" type="submit">{t('saveAsScheme')}</button>
        {savedScheme && <span className="text-primary text-xs">{t('saved')} ✓</span>}
      </form>

      <div className="category-manager-grid grid grid-cols-[minmax(0,1fr)_150px] gap-x-3 mb-2 px-1 text-xs text-ink/40">
        <span>{t('categoryName')}</span><span>{t('weight')} %</span>
      </div>

      <div className="space-y-2 mb-4">
        {categories.map((category) => (
          <div key={category.id} className="category-manager-grid grid grid-cols-[minmax(0,1fr)_150px] gap-x-3 items-center border-b border-line pb-2">
            <div className="flex items-center gap-2 min-w-0">
              <input className="input text-sm flex-1" defaultValue={category.name} onBlur={(event) => event.target.value.trim() !== category.name && updateCategory(category.id, { name: event.target.value.trim() })} />
              <button className="text-danger text-xs hover:underline shrink-0" type="button" onClick={() => deleteCategory(category.id)} title={t('deleteClass')}>×</button>
            </div>
            <div className="relative">
              <input className="input text-sm pl-6" type="number" min="0" max="100" step="any" defaultValue={category.weight_percent} onBlur={(event) => Number(event.target.value) !== Number(category.weight_percent) && updateCategory(category.id, { weight_percent: Number(event.target.value) })} />
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink/40">%</span>
            </div>
            {savedId === category.id && <span className="text-primary text-xs col-span-2">{t('saved')} ✓</span>}
          </div>
        ))}
        {categories.length === 0 && <p className="text-ink/50 text-sm py-4 text-center">{t('noCategoriesYet')}</p>}
      </div>

      <form onSubmit={addCategory} className="category-manager-add grid grid-cols-[minmax(0,1fr)_150px_auto] gap-3 pt-3 border-t border-line items-center">
        <input className="input text-sm" placeholder={t('newCategoryExample')} required value={newCat.name} onChange={(event) => setNewCat({ ...newCat, name: event.target.value })} />
        <div className="relative">
          <input className="input text-sm pl-6" type="number" min="0" max="100" placeholder="0" value={newCat.weight_percent || ''} onChange={(event) => setNewCat({ ...newCat, weight_percent: Number(event.target.value) })} />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink/40">%</span>
        </div>
        <button className="btn-primary text-sm px-3" type="submit">{t('add')}</button>
      </form>
    </div>
  );
}

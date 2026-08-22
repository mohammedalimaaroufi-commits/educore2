import React, { useEffect, useState } from 'react';
import api from '../api/client';
import { getTeacherId } from '../utils/localCache.js';
import { queueMutation } from '../utils/snapshotSync.js';
import { readSettingsCache, writeSettingsCache } from '../utils/settingsCache.js';
import { useLocale } from '../context/LocaleContext.jsx';
import { useConfirmDialog } from './ConfirmDialog.jsx';

const localId = (prefix) => `local-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export default function SchemesManager({ classId, onApplied }) {
  const { t } = useLocale();
  const { confirm, confirmDialog } = useConfirmDialog();
  const teacherId = getTeacherId();
  const [schemes, setSchemes] = useState(() => readSettingsCache(teacherId, 'grading-schemes', []));
  const [saveAsName, setSaveAsName] = useState('');
  const [newSchemeName, setNewSchemeName] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [newCat, setNewCat] = useState({ name: '', weight_percent: 0 });
  const [feedback, setFeedback] = useState('');

  const persist = (next) => {
    setSchemes(next);
    writeSettingsCache(teacherId, 'grading-schemes', next);
  };

  const load = async () => {
    try {
      const { data } = await api.get('/schemes');
      persist(data.schemes || []);
    } catch {
      if (!schemes.length) setFeedback(t('offline'));
    }
  };
  useEffect(() => { void load(); }, []);

  const saveCurrentAsScheme = async (event) => {
    event.preventDefault();
    if (!saveAsName.trim()) return;
    try {
      const { data } = await api.post('/schemes/from-class', { class_id: classId, name: saveAsName.trim() });
      const saved = data.scheme || data;
      if (saved?.id) persist([...schemes, saved]); else await load();
      setSaveAsName('');
      setFeedback(t('savedAndSynced'));
    } catch {
      setFeedback(t('serverUnavailable'));
    }
  };

  const createEmptyScheme = async (event) => {
    event.preventDefault();
    if (!newSchemeName.trim()) return;
    const payload = { name: newSchemeName.trim(), categories: [] };
    const optimistic = { id: localId('scheme'), ...payload, is_default: 0 };
    persist([...schemes, optimistic]);
    setNewSchemeName('');
    try {
      const { data } = await api.post('/schemes', payload);
      const saved = data.scheme || data;
      persist([...schemes, optimistic].map((item) => item.id === optimistic.id ? saved : item));
      setFeedback(t('savedAndSynced'));
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: '/schemes', data: payload });
      setFeedback(t('savedLocally'));
    }
  };

  const applyScheme = async (schemeId, replace) => {
    const accepted = await confirm({ title: t('applySavedScheme'), message: replace ? t('replaceSchemeConfirm') : t('appendSchemeConfirm'), confirmLabel: t('apply'), cancelLabel: t('cancel'), danger: false });
    if (!accepted) return;
    try {
      await api.post(`/schemes/${schemeId}/apply`, { class_id: classId, replace });
      onApplied?.();
      setFeedback(t('savedAndSynced'));
    } catch {
      setFeedback(t('serverUnavailable'));
    }
  };

  const deleteScheme = async (id) => {
    const accepted = await confirm({ title: t('deleteScheme'), message: t('deleteSchemeConfirm'), confirmLabel: t('delete'), cancelLabel: t('cancel'), danger: true });
    if (!accepted) return;
    persist(schemes.filter((scheme) => scheme.id !== id));
    try {
      if (!String(id).startsWith('local-')) await api.delete(`/schemes/${id}`);
      setFeedback(t('savedAndSynced'));
    } catch {
      await queueMutation(teacherId, { method: 'DELETE', url: `/schemes/${id}` });
      setFeedback(t('savedLocally'));
    }
  };

  const toggleDefault = async (scheme) => {
    const next = schemes.map((item) => ({ ...item, is_default: item.id === scheme.id ? (scheme.is_default ? 0 : 1) : 0 }));
    persist(next);
    try {
      await api.post(`/schemes/${scheme.id}/${scheme.is_default ? 'unset-default' : 'set-default'}`);
      setFeedback(t('savedAndSynced'));
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: `/schemes/${scheme.id}/${scheme.is_default ? 'unset-default' : 'set-default'}` });
      setFeedback(t('savedLocally'));
    }
  };

  const addCategoryToScheme = async (schemeId, event) => {
    event.preventDefault();
    if (!newCat.name.trim()) return;
    const payload = { name: newCat.name.trim(), weight_percent: Number(newCat.weight_percent || 0) };
    const next = schemes.map((scheme) => scheme.id === schemeId ? { ...scheme, categories: [...(scheme.categories || []), { id: localId('category'), ...payload }] } : scheme);
    persist(next);
    setNewCat({ name: '', weight_percent: 0 });
    try {
      await api.post(`/schemes/${schemeId}/categories`, payload);
      setFeedback(t('savedAndSynced'));
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: `/schemes/${schemeId}/categories`, data: payload });
      setFeedback(t('savedLocally'));
    }
  };

  const updateSchemeCategory = async (schemeId, catId, field, value) => {
    const next = schemes.map((scheme) => scheme.id === schemeId ? { ...scheme, categories: (scheme.categories || []).map((category) => category.id === catId ? { ...category, [field]: value } : category) } : scheme);
    persist(next);
    try {
      await api.patch(`/schemes/${schemeId}/categories/${catId}`, { [field]: value });
      setFeedback(t('savedAndSynced'));
    } catch {
      await queueMutation(teacherId, { method: 'PATCH', url: `/schemes/${schemeId}/categories/${catId}`, data: { [field]: value } });
      setFeedback(t('savedLocally'));
    }
  };

  const deleteSchemeCategory = async (schemeId, catId) => {
    persist(schemes.map((scheme) => scheme.id === schemeId ? { ...scheme, categories: (scheme.categories || []).filter((category) => category.id !== catId) } : scheme));
    try {
      await api.delete(`/schemes/${schemeId}/categories/${catId}`);
      setFeedback(t('savedAndSynced'));
    } catch {
      await queueMutation(teacherId, { method: 'DELETE', url: `/schemes/${schemeId}/categories/${catId}` });
      setFeedback(t('savedLocally'));
    }
  };

  return (
    <div className="space-y-5">
      {confirmDialog}
      {feedback && <p className="text-primary text-xs">{feedback}</p>}
      {classId && <div className="card p-4"><h3 className="font-bold mb-2">{t('saveClassAsScheme')}</h3><p className="text-xs text-ink/60 mb-3">{t('saveClassAsSchemeText')}</p><form onSubmit={saveCurrentAsScheme} className="flex gap-2"><input className="input text-sm flex-1" placeholder={t('schemeNamePlaceholder')} value={saveAsName} onChange={(event) => setSaveAsName(event.target.value)} required /><button className="btn-primary text-sm" type="submit">{t('saveAsScheme')}</button></form></div>}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3"><h3 className="font-bold">{t('savedGradeSchemes')}</h3></div>
        {!classId && <p className="text-xs text-ink/60 mb-3">{t('defaultSchemeText')}</p>}
        <form onSubmit={createEmptyScheme} className="flex gap-2 mb-4"><input className="input text-sm flex-1" placeholder={t('newEmptyScheme')} value={newSchemeName} onChange={(event) => setNewSchemeName(event.target.value)} required /><button className="btn-secondary text-sm" type="submit">+ {t('createScheme')}</button></form>
        {schemes.length === 0 && <p className="text-ink/50 text-sm">{t('noSchemes')}</p>}
        <div className="space-y-3">
          {schemes.map((scheme) => <div key={scheme.id} className={`border rounded-lg p-3 ${scheme.is_default ? 'border-primary/50 bg-primary/5' : 'border-line'}`}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <button className="font-medium text-sm flex items-center gap-2" onClick={() => setExpandedId(expandedId === scheme.id ? null : scheme.id)}>{scheme.name} ({(scheme.categories || []).length} {t('categoryCountShort')}){scheme.is_default && <span className="text-[10px] bg-primary text-white px-1.5 py-0.5 rounded-full">{t('defaultForNewClasses')}</span>}</button>
              <div className="flex gap-2 text-xs items-center">{classId ? <><button className="text-primary" onClick={() => applyScheme(scheme.id, false)}>{t('addToClass')}</button><button className="text-accent" onClick={() => applyScheme(scheme.id, true)}>{t('replaceClassCategories')}</button></> : <button className={scheme.is_default ? 'text-ink/50' : 'text-primary'} onClick={() => toggleDefault(scheme)}>{scheme.is_default ? t('unsetDefault') : t('setDefault')}</button>}<button className="text-danger" onClick={() => deleteScheme(scheme.id)}>{t('deleteClass')}</button></div>
            </div>
            {expandedId === scheme.id && <div className="mt-3 space-y-2">{(scheme.categories || []).map((category) => <div key={category.id} className="flex items-center gap-2"><input className="input text-sm flex-1" defaultValue={category.name} onBlur={(event) => event.target.value !== category.name && updateSchemeCategory(scheme.id, category.id, 'name', event.target.value)} /><input className="input text-sm w-24" type="number" defaultValue={category.weight_percent} onBlur={(event) => Number(event.target.value) !== category.weight_percent && updateSchemeCategory(scheme.id, category.id, 'weight_percent', Number(event.target.value))} /><span className="text-xs text-ink/50">%</span><button className="text-danger text-xs" onClick={() => deleteSchemeCategory(scheme.id, category.id)}>{t('deleteClass')}</button></div>)}<form onSubmit={(event) => addCategoryToScheme(scheme.id, event)} className="flex gap-2 pt-2 border-t border-line"><input className="input text-sm flex-1" placeholder={t('newCategory')} value={newCat.name} onChange={(event) => setNewCat({ ...newCat, name: event.target.value })} required /><input className="input text-sm w-24" type="number" placeholder="%" value={newCat.weight_percent} onChange={(event) => setNewCat({ ...newCat, weight_percent: Number(event.target.value) })} /><button className="btn-secondary text-xs" type="submit">{t('add')}</button></form></div>}
          </div>)}
        </div>
      </div>
    </div>
  );
}

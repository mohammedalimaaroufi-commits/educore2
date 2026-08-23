import React, { useEffect, useState } from 'react';
import api, { getLocalFirst } from '../api/client';
import Icon from './Icon.jsx';
import { POSITIVE_BEHAVIOR_ICONS, NEGATIVE_BEHAVIOR_ICONS } from '../constants.js';
import { getTeacherId } from '../utils/localCache.js';
import { queueMutation } from '../utils/snapshotSync.js';
import { readSettingsCache, writeSettingsCache } from '../utils/settingsCache.js';
import { useLocale } from '../context/LocaleContext.jsx';
import { useConfirmDialog } from './ConfirmDialog.jsx';

const localId = () => `local-behavior-template-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const CACHE_SECTION = 'behavior-templates';

export default function BehaviorTemplateManager() {
  const { t } = useLocale();
  const { confirm, confirmDialog } = useConfirmDialog();
  const teacherId = getTeacherId();
  const [templates, setTemplates] = useState(() => readSettingsCache(teacherId, CACHE_SECTION, []));
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [newType, setNewType] = useState({ label: '', polarity: 'positive', points: 1, icon: 'star' });

  const persist = (next) => {
    setTemplates(next);
    writeSettingsCache(teacherId, CACHE_SECTION, next);
  };

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await getLocalFirst('/settings/behavior-templates');
      persist(data.templates || []);
    } catch {
      if (!templates.length) setFeedback(t('offline'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const addType = async (event) => {
    event.preventDefault();
    if (!newType.label.trim()) return;
    const optimistic = { id: localId(), ...newType, label: newType.label.trim(), pending: true };
    persist([...templates, optimistic]);
    setNewType({ label: '', polarity: 'positive', points: 1, icon: 'star' });
    try {
      const { data } = await api.post('/settings/behavior-templates', newType);
      persist(templates.concat(optimistic).map((item) => item.id === optimistic.id ? data.template : item));
      setFeedback(t('savedAndSynced'));
    } catch {
      await queueMutation(teacherId, { method: 'POST', url: '/settings/behavior-templates', data: newType });
      setFeedback(t('savedLocally'));
    }
  };

  const updateType = async (id, field, value) => {
    const next = templates.map((item) => item.id === id ? { ...item, [field]: value } : item);
    persist(next);
    try {
      const { data } = await api.patch(`/settings/behavior-templates/${id}`, { [field]: value });
      persist(next.map((item) => item.id === id ? data.template : item));
      setFeedback(t('savedAndSynced'));
    } catch {
      if (!String(id).startsWith('local-')) await queueMutation(teacherId, { method: 'PATCH', url: `/settings/behavior-templates/${id}`, data: { [field]: value } });
      setFeedback(t('savedLocally'));
    }
  };

  const deleteType = async (id) => {
    const accepted = await confirm({ title: t('deleteBehavior'), message: t('deleteBehaviorConfirm'), confirmLabel: t('delete'), cancelLabel: t('cancel'), danger: true });
    if (!accepted) return;
    const next = templates.filter((item) => item.id !== id);
    persist(next);
    try {
      if (!String(id).startsWith('local-')) await api.delete(`/settings/behavior-templates/${id}`);
      setFeedback(t('savedAndSynced'));
    } catch {
      await queueMutation(teacherId, { method: 'DELETE', url: `/settings/behavior-templates/${id}` });
      setFeedback(t('savedLocally'));
    }
  };

  const iconOptions = newType.polarity === 'positive' ? POSITIVE_BEHAVIOR_ICONS : NEGATIVE_BEHAVIOR_ICONS;

  return (
    <div className="card p-5">
      {confirmDialog}
      <h3 className="font-bold text-lg mb-1">{t('behaviorTemplates')}</h3>
      <p className="text-xs text-ink/60 mb-4">{t('behaviorTemplatesDescription')}</p>
      {feedback && <p className="text-primary text-xs mb-3">{feedback}</p>}

      {loading ? (
        <p className="text-ink/50 text-sm">{t('appLoading')}</p>
      ) : (
        <div className="space-y-2 mb-5">
          {templates.map((item) => (
            <div key={item.id} className={`flex items-center gap-2 border rounded-lg p-2 ${item.polarity === 'positive' ? 'border-primary/30' : 'border-danger/30'}`}>
              <Icon name={item.icon} className={`w-4 h-4 flex-shrink-0 ${item.polarity === 'positive' ? 'text-primary' : 'text-danger'}`} />
              <input className="input text-sm flex-1" defaultValue={item.label} onBlur={(event) => event.target.value !== item.label && updateType(item.id, 'label', event.target.value)} />
              <select className="input text-sm w-24" defaultValue={item.polarity} onChange={(event) => updateType(item.id, 'polarity', event.target.value)}>
                <option value="positive">{t('positiveLabel')}</option>
                <option value="negative">{t('negativeLabel')}</option>
              </select>
              <input className="input text-sm w-16" type="number" defaultValue={item.points} onBlur={(event) => Number(event.target.value) !== item.points && updateType(item.id, 'points', Number(event.target.value))} />
              <button className="text-danger text-xs" onClick={() => deleteType(item.id)}>{t('deleteClass')}</button>
            </div>
          ))}
          {templates.length === 0 && <p className="text-ink/50 text-sm py-2">{t('noBehaviorTemplates')}</p>}
        </div>
      )}

      <form onSubmit={addType} className="pt-3 border-t border-line space-y-2">
        <div className="flex flex-wrap gap-2">
          <input className="input text-sm flex-1" placeholder={t('behaviorName')} required value={newType.label} onChange={(event) => setNewType({ ...newType, label: event.target.value })} />
          <select className="input text-sm w-28" value={newType.polarity} onChange={(event) => setNewType({ ...newType, polarity: event.target.value, icon: event.target.value === 'positive' ? 'star' : 'clock' })}>
            <option value="positive">{t('positiveLabel')}</option>
            <option value="negative">{t('negativeLabel')}</option>
          </select>
          <input className="input text-sm w-20" type="number" value={newType.points} onChange={(event) => setNewType({ ...newType, points: Number(event.target.value) })} />
        </div>
        <div className="flex items-center gap-2">
          {iconOptions.map((icon) => <button key={icon} type="button" onClick={() => setNewType({ ...newType, icon })} className={`p-2 rounded-lg border ${newType.icon === icon ? 'border-primary bg-primary/10' : 'border-line'}`}><Icon name={icon} className="w-4 h-4" /></button>)}
          <button className="btn-primary text-sm mr-auto" type="submit">+ {t('add')}</button>
        </div>
      </form>
    </div>
  );
}

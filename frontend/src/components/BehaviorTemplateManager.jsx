import React, { useEffect, useState } from 'react';
import api from '../api/client';
import Icon from './Icon.jsx';
import { POSITIVE_BEHAVIOR_ICONS, NEGATIVE_BEHAVIOR_ICONS } from '../constants.js';

// Teacher-level behavior presets, applied automatically to every new class from now on
// instead of the app's built-in starter list. Lives in الإعدادات العامة — a class's own live
// behavior list stays editable per-class from تبويب السلوك as before.
export default function BehaviorTemplateManager() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newType, setNewType] = useState({ label: '', polarity: 'positive', points: 1, icon: 'star' });

  const load = async () => {
    setLoading(true);
    const { data } = await api.get('/settings/behavior-templates');
    setTemplates(data.templates);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const addType = async (e) => {
    e.preventDefault();
    if (!newType.label.trim()) return;
    await api.post('/settings/behavior-templates', newType);
    setNewType({ label: '', polarity: 'positive', points: 1, icon: 'star' });
    load();
  };

  const updateType = async (id, field, value) => {
    await api.patch(`/settings/behavior-templates/${id}`, { [field]: value });
    load();
  };

  const deleteType = async (id) => {
    if (!confirm('حذف هذا السلوك من القائمة الافتراضية؟ (لن يؤثر على الصفوف الموجودة حاليًا)')) return;
    await api.delete(`/settings/behavior-templates/${id}`);
    load();
  };

  const iconOptions = newType.polarity === 'positive' ? POSITIVE_BEHAVIOR_ICONS : NEGATIVE_BEHAVIOR_ICONS;

  return (
    <div className="card p-5">
      <h3 className="font-bold text-lg mb-1">تحرير السلوك المخصص</h3>
      <p className="text-xs text-ink/60 mb-4">
        هذه القائمة تُستخدم تلقائيًا عند إنشاء أي صف جديد بدلاً من القائمة الافتراضية للتطبيق. تعديلها هنا لا يغيّر أنواع السلوك في الصفوف الموجودة حاليًا — تلك تُدار من تبويب "السلوك" داخل كل صف.
      </p>

      {loading ? (
        <p className="text-ink/50 text-sm">جارِ التحميل...</p>
      ) : (
        <div className="space-y-2 mb-5">
          {templates.map((t) => (
            <div key={t.id} className={`flex items-center gap-2 border rounded-lg p-2 ${t.polarity === 'positive' ? 'border-primary/30' : 'border-danger/30'}`}>
              <Icon name={t.icon} className={`w-4 h-4 flex-shrink-0 ${t.polarity === 'positive' ? 'text-primary' : 'text-danger'}`} />
              <input className="input text-sm flex-1" defaultValue={t.label}
                onBlur={(e) => e.target.value !== t.label && updateType(t.id, 'label', e.target.value)} />
              <select className="input text-sm w-24" defaultValue={t.polarity}
                onChange={(e) => updateType(t.id, 'polarity', e.target.value)}>
                <option value="positive">إيجابي</option>
                <option value="negative">سلبي</option>
              </select>
              <input className="input text-sm w-16" type="number" defaultValue={t.points}
                onBlur={(e) => Number(e.target.value) !== t.points && updateType(t.id, 'points', Number(e.target.value))} />
              <button className="text-danger text-xs" onClick={() => deleteType(t.id)}>حذف</button>
            </div>
          ))}
          {templates.length === 0 && (
            <p className="text-ink/50 text-sm py-2">لا توجد قائمة سلوك مخصصة بعد — الصفوف الجديدة ستستخدم القائمة الافتراضية للتطبيق حتى تضيف واحدة هنا.</p>
          )}
        </div>
      )}

      <form onSubmit={addType} className="pt-3 border-t border-line space-y-2">
        <div className="flex flex-wrap gap-2">
          <input className="input text-sm flex-1" placeholder="اسم السلوك (مثال: مشاركة متميزة)" required
            value={newType.label} onChange={(e) => setNewType({ ...newType, label: e.target.value })} />
          <select className="input text-sm w-28" value={newType.polarity}
            onChange={(e) => setNewType({ ...newType, polarity: e.target.value, icon: e.target.value === 'positive' ? 'star' : 'clock' })}>
            <option value="positive">إيجابي</option>
            <option value="negative">سلبي</option>
          </select>
          <input className="input text-sm w-20" type="number" value={newType.points}
            onChange={(e) => setNewType({ ...newType, points: Number(e.target.value) })} />
        </div>
        <div className="flex items-center gap-2">
          {iconOptions.map((ic) => (
            <button key={ic} type="button" onClick={() => setNewType({ ...newType, icon: ic })}
              className={`p-2 rounded-lg border ${newType.icon === ic ? 'border-primary bg-primary/10' : 'border-line'}`}>
              <Icon name={ic} className="w-4 h-4" />
            </button>
          ))}
          <button className="btn-primary text-sm mr-auto" type="submit">+ إضافة للقائمة</button>
        </div>
      </form>
    </div>
  );
}

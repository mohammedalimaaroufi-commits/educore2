import React, { useEffect, useState } from 'react';
import api from '../api/client';

// Used two ways:
// - Inside a class's دفتر الدرجات (classId passed): full management + apply-to-this-class actions.
// - Inside الإعدادات العامة (classId omitted): manage the reusable scheme library and pick a
//   default one to auto-apply to every new class ("فئات التقييم" tab).
export default function SchemesManager({ classId, onApplied }) {
  const [schemes, setSchemes] = useState([]);
  const [saveAsName, setSaveAsName] = useState('');
  const [newSchemeName, setNewSchemeName] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [newCat, setNewCat] = useState({ name: '', weight_percent: 0 });

  const load = async () => {
    const { data } = await api.get('/schemes');
    setSchemes(data.schemes);
  };
  useEffect(() => { load(); }, []);

  const saveCurrentAsScheme = async (e) => {
    e.preventDefault();
    if (!saveAsName) return;
    await api.post('/schemes/from-class', { class_id: classId, name: saveAsName });
    setSaveAsName('');
    load();
  };

  const createEmptyScheme = async (e) => {
    e.preventDefault();
    if (!newSchemeName) return;
    await api.post('/schemes', { name: newSchemeName, categories: [] });
    setNewSchemeName('');
    load();
  };

  const applyScheme = async (schemeId, replace) => {
    const msg = replace
      ? 'سيتم حذف فئات الدرجات الحالية لهذا الصف (وكل الدرجات المرتبطة بها!) واستبدالها بهذا المخطط. متابعة؟'
      : 'سيتم إضافة فئات هذا المخطط إلى فئات الصف الحالية. متابعة؟';
    if (!confirm(msg)) return;
    await api.post(`/schemes/${schemeId}/apply`, { class_id: classId, replace });
    onApplied?.();
  };

  const deleteScheme = async (id) => {
    if (!confirm('حذف هذا المخطط نهائيًا؟')) return;
    await api.delete(`/schemes/${id}`);
    load();
  };

  const toggleDefault = async (scheme) => {
    if (scheme.is_default) await api.post(`/schemes/${scheme.id}/unset-default`);
    else await api.post(`/schemes/${scheme.id}/set-default`);
    load();
  };

  const addCategoryToScheme = async (schemeId, e) => {
    e.preventDefault();
    await api.post(`/schemes/${schemeId}/categories`, newCat);
    setNewCat({ name: '', weight_percent: 0 });
    load();
  };

  const updateSchemeCategory = async (schemeId, catId, field, value) => {
    await api.patch(`/schemes/${schemeId}/categories/${catId}`, { [field]: value });
    load();
  };

  const deleteSchemeCategory = async (schemeId, catId) => {
    await api.delete(`/schemes/${schemeId}/categories/${catId}`);
    load();
  };

  return (
    <div className="space-y-5">
      {classId && (
        <div className="card p-4">
          <h3 className="font-bold mb-2">حفظ فئات هذا الصف كمخطط جديد</h3>
          <p className="text-xs text-ink/60 mb-3">يمكنك اعتماد نفس توزيع الفئات في أي صف آخر لاحقًا دون إعادة الإنشاء.</p>
          <form onSubmit={saveCurrentAsScheme} className="flex gap-2">
            <input className="input text-sm flex-1" placeholder="اسم المخطط (مثال: مخطط الفصل الأول)" value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)} required />
            <button className="btn-primary text-sm" type="submit">حفظ كمخطط</button>
          </form>
        </div>
      )}

      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold">مخططات فئات الدرجات المحفوظة</h3>
        </div>
        {!classId && (
          <p className="text-xs text-ink/60 mb-3">
            حدد مخططًا "افتراضي" ليُستخدم تلقائيًا في فئات التقييم عند إنشاء أي صف جديد، بدل القائمة الافتراضية للتطبيق.
          </p>
        )}
        <form onSubmit={createEmptyScheme} className="flex gap-2 mb-4">
          <input className="input text-sm flex-1" placeholder="اسم مخطط جديد فارغ" value={newSchemeName}
            onChange={(e) => setNewSchemeName(e.target.value)} required />
          <button className="btn-secondary text-sm" type="submit">+ إنشاء مخطط فارغ</button>
        </form>

        {schemes.length === 0 && <p className="text-ink/50 text-sm">لا توجد مخططات محفوظة بعد.</p>}

        <div className="space-y-3">
          {schemes.map((s) => (
            <div key={s.id} className={`border rounded-lg p-3 ${s.is_default ? 'border-primary/50 bg-primary/5' : 'border-line'}`}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <button className="font-medium text-sm flex items-center gap-2" onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                  {s.name} ({s.categories.length} فئة)
                  {s.is_default && <span className="text-[10px] bg-primary text-white px-1.5 py-0.5 rounded-full">افتراضي للصفوف الجديدة</span>}
                </button>
                <div className="flex gap-2 text-xs items-center">
                  {classId ? (
                    <>
                      <button className="text-primary" onClick={() => applyScheme(s.id, false)}>إضافة لهذا الصف</button>
                      <button className="text-accent" onClick={() => applyScheme(s.id, true)}>استبدال فئات الصف</button>
                    </>
                  ) : (
                    <button className={s.is_default ? 'text-ink/50' : 'text-primary'} onClick={() => toggleDefault(s)}>
                      {s.is_default ? 'إلغاء الافتراضي' : 'تعيين كافتراضي'}
                    </button>
                  )}
                  <button className="text-danger" onClick={() => deleteScheme(s.id)}>حذف</button>
                </div>
              </div>

              {expandedId === s.id && (
                <div className="mt-3 space-y-2">
                  {s.categories.map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <input className="input text-sm flex-1" defaultValue={c.name}
                        onBlur={(e) => e.target.value !== c.name && updateSchemeCategory(s.id, c.id, 'name', e.target.value)} />
                      <input className="input text-sm w-24" type="number" defaultValue={c.weight_percent}
                        onBlur={(e) => Number(e.target.value) !== c.weight_percent && updateSchemeCategory(s.id, c.id, 'weight_percent', Number(e.target.value))} />
                      <span className="text-xs text-ink/50">%</span>
                      <button className="text-danger text-xs" onClick={() => deleteSchemeCategory(s.id, c.id)}>حذف</button>
                    </div>
                  ))}
                  <form onSubmit={(e) => addCategoryToScheme(s.id, e)} className="flex gap-2 pt-2 border-t border-line">
                    <input className="input text-sm flex-1" placeholder="فئة جديدة" value={newCat.name}
                      onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} required />
                    <input className="input text-sm w-24" type="number" placeholder="%" value={newCat.weight_percent}
                      onChange={(e) => setNewCat({ ...newCat, weight_percent: Number(e.target.value) })} />
                    <button className="btn-secondary text-xs" type="submit">إضافة</button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

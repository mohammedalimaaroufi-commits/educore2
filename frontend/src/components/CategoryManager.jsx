import React, { useEffect, useState } from 'react';
import api from '../api/client';
import { getTeacherId } from '../utils/localCache.js';
import { syncSnapshot } from '../utils/snapshotSync.js';

export default function CategoryManager({ classId, refreshKey, onChange }) {
  const [categories, setCategories] = useState([]);
  const [totalWeight, setTotalWeight] = useState(0);
  const [newCat, setNewCat] = useState({ name: '', weight_percent: 0 });
  const [saveAsName, setSaveAsName] = useState('');
  const [savedId, setSavedId] = useState(null);
  const [savedScheme, setSavedScheme] = useState(false);
  const teacherId = getTeacherId();

  const load = async () => {
    const { data } = await api.get('/grades/categories', { params: { class_id: classId } });
    setCategories(data.categories || []);
    setTotalWeight(Number(data.totalWeight || 0));
  };

  useEffect(() => { load().catch(() => {}); }, [classId, refreshKey]);

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
    if (!confirm('حذف هذه الفئة سيحذف التقييمات والدرجات المرتبطة بها. متابعة؟')) return;
    await api.delete(`/grades/categories/${id}`);
    await refreshLocalSnapshot();
    await load();
    onChange?.();
  };

  const saveCurrentAsScheme = async (event) => {
    event.preventDefault();
    if (!saveAsName.trim()) return;
    await api.post('/schemes/from-class', { class_id: classId, name: saveAsName.trim() });
    setSaveAsName('');
    setSavedScheme(true);
    setTimeout(() => setSavedScheme(false), 1800);
  };

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-bold text-lg">فئات التقييم لهذا الصف</h3>
          <p className="text-xs text-ink/50 mt-1">أدخل اسم الفئة ووزنها. أضف الأسئلة والتقييمات الفرعية من جدول الدرجات، وسيظهر تنبيه بصري عند اختلاف مجموعها عن الوزن.</p>
        </div>
        <span className={`text-sm font-medium px-3 py-1 rounded-full ${Math.round(totalWeight) === 100 ? 'bg-primary/10 text-primary' : 'bg-danger/10 text-danger'}`}>
          الإجمالي: {totalWeight}% {Math.round(totalWeight) === 100 ? '✓ متوازن' : '(يفضل أن يساوي 100%)'}
        </span>
      </div>

      <form onSubmit={saveCurrentAsScheme} className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-lg bg-surface border border-line">
        <span className="text-sm font-medium">حفظ توزيع الفئات كمخطط:</span>
        <input className="input text-sm flex-1 min-w-[190px]" placeholder="اسم المخطط" value={saveAsName} onChange={(event) => setSaveAsName(event.target.value)} required />
        <button className="btn-secondary text-sm" type="submit">حفظ كمخطط</button>
        {savedScheme && <span className="text-primary text-xs">تم حفظ المخطط ✓</span>}
      </form>

      <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-x-3 mb-2 px-1 text-xs text-ink/40">
        <span>اسم الفئة</span><span>الوزن %</span>
      </div>

      <div className="space-y-2 mb-4">
        {categories.map((category) => (
          <div key={category.id} className="grid grid-cols-[minmax(0,1fr)_150px] gap-x-3 items-center border-b border-line pb-2">
            <div className="flex items-center gap-2 min-w-0">
              <input className="input text-sm flex-1" defaultValue={category.name} onBlur={(event) => event.target.value.trim() !== category.name && updateCategory(category.id, { name: event.target.value.trim() })} />
              <button className="text-danger text-xs hover:underline shrink-0" type="button" onClick={() => deleteCategory(category.id)} title="حذف الفئة">حذف</button>
            </div>
            <div className="relative">
              <input className="input text-sm pl-6" type="number" min="0" max="100" defaultValue={category.weight_percent} onBlur={(event) => Number(event.target.value) !== Number(category.weight_percent) && updateCategory(category.id, { weight_percent: Number(event.target.value) })} />
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink/40">%</span>
            </div>
            {savedId === category.id && <span className="text-primary text-xs col-span-2">تم الحفظ ✓</span>}
          </div>
        ))}
        {categories.length === 0 && <p className="text-ink/50 text-sm py-4 text-center">لا توجد فئات بعد.</p>}
      </div>

      <form onSubmit={addCategory} className="grid grid-cols-[minmax(0,1fr)_150px_auto] gap-3 pt-3 border-t border-line items-center">
        <input className="input text-sm" placeholder="اسم فئة جديدة (مثال: مشاركة)" required value={newCat.name} onChange={(event) => setNewCat({ ...newCat, name: event.target.value })} />
        <div className="relative">
          <input className="input text-sm pl-6" type="number" min="0" max="100" placeholder="0" value={newCat.weight_percent || ''} onChange={(event) => setNewCat({ ...newCat, weight_percent: Number(event.target.value) })} />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink/40">%</span>
        </div>
        <button className="btn-primary text-sm px-3" type="submit">إضافة</button>
      </form>
    </div>
  );
}

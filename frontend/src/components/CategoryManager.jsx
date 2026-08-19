import React, { useEffect, useState } from 'react';
import api from '../api/client';

export default function CategoryManager({ classId, refreshKey, onChange }) {
  const [categories, setCategories] = useState([]);
  const [totalWeight, setTotalWeight] = useState(0);
  const [newCat, setNewCat] = useState({ name: '', weight_percent: 0 });
  const [savedId, setSavedId] = useState(null);

  const load = async () => {
    const { data } = await api.get('/grades/categories', { params: { class_id: classId } });
    setCategories(data.categories);
    setTotalWeight(data.totalWeight);
  };
  useEffect(() => { load(); }, [classId, refreshKey]);

  const addCategory = async (e) => {
    e.preventDefault();
    await api.post('/grades/categories', { class_id: classId, ...newCat });
    setNewCat({ name: '', weight_percent: 0 });
    load();
    onChange?.();
  };

  const updateCategory = async (id, field, value) => {
    await api.patch(`/grades/categories/${id}`, { [field]: value });
    setSavedId(id);
    setTimeout(() => setSavedId(null), 1200);
    load();
    onChange?.();
  };

  const deleteCategory = async (id) => {
    if (!confirm('حذف هذه الفئة سيحذف كل التقييمات والدرجات المرتبطة بها. متابعة؟')) return;
    await api.delete(`/grades/categories/${id}`);
    load();
    onChange?.();
  };

  const rowGrid = 'grid gap-3 items-center';
  const rowCols = { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 96px 32px', gap: '0.75rem', alignItems: 'center' };

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h3 className="font-bold text-lg">فئات التقييم لهذا الصف</h3>
        <span className={`text-sm font-medium px-3 py-1 rounded-full ${Math.round(totalWeight) === 100 ? 'bg-primary/10 text-primary' : 'bg-danger/10 text-danger'}`}>
          الإجمالي: {totalWeight}% {Math.round(totalWeight) === 100 ? '✓ متوازن' : '(يجب أن يساوي 100%)'}
        </span>
      </div>

      {categories.length > 0 && (
        <div style={rowCols} className="mb-2 px-1 text-xs text-ink/40">
          <span>اسم الفئة</span>
          <span>الوزن %</span>
          <span></span>
        </div>
      )}

      <div className="space-y-2 mb-4">
        {categories.map((c) => (
          <div key={c.id} style={rowCols}>
            <input className="input text-sm" defaultValue={c.name}
              onBlur={(e) => e.target.value !== c.name && updateCategory(c.id, 'name', e.target.value)} />
            <div className="relative">
              <input className="input text-sm pl-6" type="number" defaultValue={c.weight_percent}
                onBlur={(e) => Number(e.target.value) !== c.weight_percent && updateCategory(c.id, 'weight_percent', Number(e.target.value))} />
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink/40">%</span>
            </div>
            <button className="text-danger text-xs hover:underline" onClick={() => deleteCategory(c.id)} title="حذف الفئة">حذف</button>
            {savedId === c.id && <span className="text-primary text-xs col-span-3">تم الحفظ ✓</span>}
          </div>
        ))}
        {categories.length === 0 && (
          <p className="text-ink/50 text-sm py-4 text-center">لا توجد فئات بعد — أضف فئة يدويًا أدناه أو اعتمد مخططًا جاهزًا من تبويب "مخططات جاهزة".</p>
        )}
      </div>

      <form onSubmit={addCategory} style={rowCols} className="pt-3 border-t border-line">
        <input className="input text-sm" placeholder="اسم فئة جديدة (مثال: واجبات منزلية)" required
          value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} />
        <div className="relative">
          <input className="input text-sm pl-6" type="number" placeholder="0"
            value={newCat.weight_percent || ''} onChange={(e) => setNewCat({ ...newCat, weight_percent: Number(e.target.value) })} />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink/40">%</span>
        </div>
        <button className="btn-primary text-sm px-2" type="submit" title="إضافة">+</button>
      </form>
    </div>
  );
}

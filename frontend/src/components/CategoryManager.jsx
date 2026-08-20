import React, { useEffect, useState } from 'react';
import api from '../api/client';
import { getTeacherId } from '../utils/localCache.js';
import { syncSnapshot } from '../utils/snapshotSync.js';

const MODE_LABELS = { direct: 'درجة واحدة من وزن الفئة', detailed: 'تفاصيل متعددة مجموعها من وزن الفئة' };

export default function CategoryManager({ classId, refreshKey, onChange }) {
  const [categories, setCategories] = useState([]);
  const [totalWeight, setTotalWeight] = useState(0);
  const [newCat, setNewCat] = useState({ name: '', weight_percent: 0, grading_mode: 'direct', details_note: '' });
  const [savedId, setSavedId] = useState(null);
  const teacherId = getTeacherId();

  const load = async () => {
    const { data } = await api.get('/grades/categories', { params: { class_id: classId } });
    setCategories(data.categories);
    setTotalWeight(data.totalWeight);
  };
  useEffect(() => { load(); }, [classId, refreshKey]);

  const addCategory = async (e) => {
    e.preventDefault();
    await api.post('/grades/categories', { class_id: classId, ...newCat, weight_percent: Number(newCat.weight_percent || 0) });
    setNewCat({ name: '', weight_percent: 0, grading_mode: 'direct', details_note: '' });
    load();
    onChange?.();
  };

  const updateCategory = async (id, patch) => {
    await api.patch(`/grades/categories/${id}`, patch);
    if (teacherId) await syncSnapshot(teacherId, { force: true });
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

  const approveDirect = async (category) => {
    const detailCount = Number(category.detail_count || 0);
    if (detailCount > 0 && !confirm(`اعتماد الإدخال المباشر سيستخدم خانة واحدة من وزن ${category.weight_percent}. ستبقى التقييمات التفصيلية ودرجاتها محفوظة ويمكن الرجوع إليها لاحقًا. متابعة؟`)) return;
    await updateCategory(category.id, { grading_mode: 'direct' });
  };

  const rowCols = { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(130px,1.2fr) 96px 32px', gap: '0.75rem', alignItems: 'center' };
  const createCols = { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 96px 145px 32px', gap: '0.75rem', alignItems: 'center' };

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div><h3 className="font-bold text-lg">فئات التقييم لهذا الصف</h3><p className="text-xs text-ink/50 mt-1">الإدخال المباشر يكون من وزن الفئة، أما التفاصيل فتتقاسم الوزن نفسه.</p></div>
        <span className={`text-sm font-medium px-3 py-1 rounded-full ${Math.round(totalWeight) === 100 ? 'bg-primary/10 text-primary' : 'bg-danger/10 text-danger'}`}>
          الإجمالي: {totalWeight}% {Math.round(totalWeight) === 100 ? '✓ متوازن' : '(يجب أن يساوي 100%)'}
        </span>
      </div>

      {categories.length > 0 && <div style={rowCols} className="mb-2 px-1 text-xs text-ink/40"><span>اسم الفئة وشرحها</span><span>النمط والتفاصيل</span><span>الوزن %</span><span></span></div>}

      <div className="space-y-3 mb-4">
        {categories.map((c) => (
          <div key={c.id} style={rowCols} className="border-b border-line pb-3">
            <div className="space-y-1"><input className="input text-sm" defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && updateCategory(c.id, { name: e.target.value })} /><input className="input text-xs" defaultValue={c.details_note || ''} placeholder="تفاصيل اختيارية للفئة" onBlur={(e) => e.target.value !== (c.details_note || '') && updateCategory(c.id, { details_note: e.target.value })} /></div>
            <div className="space-y-1"><select className="input text-xs" value={c.grading_mode || 'direct'} onChange={(e) => updateCategory(c.id, { grading_mode: e.target.value })}><option value="direct">{MODE_LABELS.direct}</option><option value="detailed">{MODE_LABELS.detailed}</option></select><p className="text-[11px] text-ink/50">{Number(c.detail_count || 0) > 0 ? `${c.detail_count} تفاصيل — مجموعها ${c.detail_total} من ${c.weight_percent}` : 'لا توجد تفاصيل؛ يظهر إدخال الفئة مباشرة'}</p>{c.grading_mode === 'detailed' && <button type="button" className="btn-secondary text-xs px-2 py-1" onClick={() => approveDirect(c)}>اعتماد مباشر</button>}{c.grading_mode === 'direct' && Number(c.detail_count || 0) > 0 && <p className="text-[11px] text-primary">الإدخال المباشر معتمد؛ التفاصيل محفوظة</p>}</div>
            <div className="relative"><input className="input text-sm pl-6" type="number" min="0" max="100" defaultValue={c.weight_percent} onBlur={(e) => Number(e.target.value) !== Number(c.weight_percent) && updateCategory(c.id, { weight_percent: Number(e.target.value) })} /><span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink/40">%</span></div>
            <button className="text-danger text-xs hover:underline" onClick={() => deleteCategory(c.id)} title="حذف الفئة">حذف</button>
            {savedId === c.id && <span className="text-primary text-xs col-span-4">تم الحفظ ✓</span>}
          </div>
        ))}
        {categories.length === 0 && <p className="text-ink/50 text-sm py-4 text-center">لا توجد فئات بعد — أضف فئة يدويًا أدناه أو اعتمد مخططًا جاهزًا من تبويب "مخططات جاهزة".</p>}
      </div>

      <form onSubmit={addCategory} style={createCols} className="pt-3 border-t border-line">
        <div className="space-y-1"><input className="input text-sm" placeholder="اسم فئة جديدة (مثال: مشاركة)" required value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} /><input className="input text-xs" placeholder="وصف أو تفاصيل الفئة (اختياري)" value={newCat.details_note} onChange={(e) => setNewCat({ ...newCat, details_note: e.target.value })} /></div>
        <div className="relative"><input className="input text-sm pl-6" type="number" min="0" max="100" placeholder="0" value={newCat.weight_percent || ''} onChange={(e) => setNewCat({ ...newCat, weight_percent: Number(e.target.value) })} /><span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink/40">%</span></div>
        <select className="input text-xs" value={newCat.grading_mode} onChange={(e) => setNewCat({ ...newCat, grading_mode: e.target.value })}><option value="direct">{MODE_LABELS.direct}</option><option value="detailed">{MODE_LABELS.detailed}</option></select>
        <button className="btn-primary text-sm px-2" type="submit" title="إضافة">+</button>
      </form>
    </div>
  );
}

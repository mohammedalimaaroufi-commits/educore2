import React, { useState } from 'react';
import GradeMatrix from './GradeMatrix.jsx';
import CategoryManager from './CategoryManager.jsx';
import SchemesManager from './SchemesManager.jsx';

const SUBTABS = [
  { id: 'grid', label: 'جدول الدرجات' },
  { id: 'categories', label: 'فئات التقييم' },
  { id: 'schemes', label: 'مخططات جاهزة' },
];

export default function GradebookTab({ classId, className }) {
  const [sub, setSub] = useState('grid');
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div>
      <div className="flex gap-2 mb-4 print:hidden">
        {SUBTABS.map((t) => (
          <button key={t.id} onClick={() => setSub(t.id)}
            className={`px-3 py-1.5 rounded-full text-sm border ${sub === t.id ? 'bg-primary text-white border-primary' : 'border-line hover:bg-surface'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'grid' && <GradeMatrix classId={classId} className={className} key={refreshKey} />}
      {sub === 'categories' && <CategoryManager classId={classId} onChange={() => setRefreshKey((k) => k + 1)} />}
      {sub === 'schemes' && <SchemesManager classId={classId} onApplied={() => { setRefreshKey((k) => k + 1); setSub('grid'); }} />}
    </div>
  );
}

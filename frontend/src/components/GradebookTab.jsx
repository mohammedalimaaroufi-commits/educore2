import React, { useState } from 'react';
import GradeMatrix from './GradeMatrix.jsx';
import CategoryManager from './CategoryManager.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
const SUBTAB_KEYS = [
  { id: 'grid', key: 'gradeGrid' },
  { id: 'categories', key: 'gradeCategories' },
];

export default function GradebookTab({ classId, className }) {
  const { t } = useLocale();
  const [sub, setSub] = useState('grid');
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div>
      <div className="gradebook-subtabs flex gap-2 mb-4 print:hidden">
        {SUBTAB_KEYS.map((item) => (
          <button key={item.id} onClick={() => setSub(item.id)}
            className={`px-3 py-1.5 rounded-full text-sm border ${sub === item.id ? 'bg-primary text-white border-primary' : 'border-line hover:bg-surface'}`}>
            {t(item.key)}
          </button>
        ))}
      </div>

      {sub === 'grid' && <GradeMatrix classId={classId} className={className} key={refreshKey} />}
      {sub === 'categories' && <CategoryManager classId={classId} refreshKey={refreshKey} onChange={() => setRefreshKey((k) => k + 1)} />}
    </div>
  );
}

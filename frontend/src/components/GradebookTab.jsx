import React, { useEffect, useState } from 'react';
import GradeMatrix from './GradeMatrix.jsx';
import CategoryManager from './CategoryManager.jsx';
import Icon from './Icon.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
const SUBTAB_KEYS = [
  { id: 'grid', key: 'gradeGrid', icon: 'fileCheck' },
  { id: 'categories', key: 'gradeCategories', icon: 'edit' },
];

export default function GradebookTab({ classId, className }) {
  const { t } = useLocale();
  const [sub, setSub] = useState('grid');
  const [refreshKey, setRefreshKey] = useState(0);
  const [gridActions, setGridActions] = useState(null);

  const switchSubtab = (next) => {
    setSub(next);
    if (next !== 'grid') setGridActions(null);
  };

  useEffect(() => () => setGridActions(null), [classId]);

  return (
    <div className="gradebook-workspace">
      <div className="gradebook-subtabs-row print:hidden">
        <div className="gradebook-subtabs" role="tablist" aria-label={t('gradebook')}>
          {SUBTAB_KEYS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={sub === item.id} onClick={() => switchSubtab(item.id)}
              className={`gradebook-subtab ${sub === item.id ? 'is-active' : ''}`}>
              <Icon name={item.icon} className="w-4 h-4" />
              <span>{t(item.key)}</span>
            </button>
          ))}
        </div>
        {sub === 'grid' && <div className="gradebook-grid-actions" aria-label={t('gradebookActions')}>
          <button className="quick-entry-trigger" type="button" onClick={() => gridActions?.openQuickEntry()} disabled={!gridActions || !gridActions.canQuickEntry}><Icon name="edit" className="w-4 h-4" /><span>{t('quickEntry')}</span></button>
          <button className="btn-secondary text-sm" type="button" onClick={() => gridActions?.exportCSV()} disabled={!gridActions}><Icon name="reports" className="w-4 h-4" /><span>{t('csvExport')}</span></button>
          <button className="btn-primary text-sm" type="button" onClick={() => gridActions?.downloadGradebookPDF()} disabled={!gridActions}><Icon name="fileCheck" className="w-4 h-4" /><span>{t('downloadPdf')}</span></button>
        </div>}
      </div>

      {sub === 'grid' && <GradeMatrix classId={classId} className={className} key={refreshKey} onActionsChange={setGridActions} />}
      {sub === 'categories' && <CategoryManager classId={classId} refreshKey={refreshKey} onChange={() => setRefreshKey((k) => k + 1)} />}
    </div>
  );
}

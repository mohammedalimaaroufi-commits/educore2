import { useEffect, useState } from 'react';
import GradeMatrix from './GradeMatrix.jsx';
import CategoryManager from './CategoryManager.jsx';
import Icon from './Icon.jsx';
import { useLocale } from '../context/LocaleContext.jsx';

const SUBTAB_KEYS = [
  { id: 'grid', key: 'gradeGrid', icon: 'fileCheck' },
  { id: 'categories', key: 'gradeCategories', icon: 'edit' },
];

const DEFAULT_VIEW_OPTIONS = {
  showNotes: true,
  showSubDetails: true,
  categoryUnit: 'percentage',
};

function readViewOptions(classId) {
  try {
    const raw = localStorage.getItem(`educore:gradebook-view:${classId}`);
    const stored = raw ? JSON.parse(raw) : {};
    return {
      ...DEFAULT_VIEW_OPTIONS,
      ...(stored && typeof stored === 'object' ? stored : {}),
      categoryUnit: stored?.categoryUnit === 'points' ? 'points' : 'percentage',
      showNotes: stored?.showNotes !== false,
      showSubDetails: stored?.showSubDetails !== false,
    };
  } catch {
    return DEFAULT_VIEW_OPTIONS;
  }
}

export default function GradebookTab({ classId, className }) {
  const { t } = useLocale();
  const [sub, setSub] = useState('grid');
  const [refreshKey, setRefreshKey] = useState(0);
  const [gridActions, setGridActions] = useState(null);
  const [viewOptions, setViewOptions] = useState(() => readViewOptions(classId));

  useEffect(() => {
    setViewOptions(readViewOptions(classId));
  }, [classId]);

  useEffect(() => {
    try {
      localStorage.setItem(`educore:gradebook-view:${classId}`, JSON.stringify(viewOptions));
    } catch {
      // The table remains usable when browser storage is unavailable.
    }
  }, [classId, viewOptions]);

  const switchSubtab = (next) => {
    setSub(next);
    if (next !== 'grid') setGridActions(null);
  };

  const updateViewOption = (patch) => setViewOptions((current) => ({ ...current, ...patch }));

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
        {sub === 'grid' && <>
          <div className="gradebook-view-options" aria-label={t('gradebookViewOptions')}>
            <label className="gradebook-view-option">
              <input type="checkbox" checked={viewOptions.showNotes} onChange={(event) => updateViewOption({ showNotes: event.target.checked })} />
              <span>{t('showGradeNotes')}</span>
            </label>
            <label className="gradebook-view-option">
              <input type="checkbox" checked={viewOptions.showSubDetails} onChange={(event) => updateViewOption({ showSubDetails: event.target.checked })} />
              <span>{t('showSubDetails')}</span>
            </label>
            <div className="gradebook-category-unit" role="radiogroup" aria-label={t('categoryDisplay')}>
              <span className="gradebook-category-unit__label">{t('categoryDisplay')}:</span>
              <label className="gradebook-view-option">
                <input type="radio" name={`gradebook-unit-${classId}`} value="percentage" checked={viewOptions.categoryUnit === 'percentage'} onChange={() => updateViewOption({ categoryUnit: 'percentage' })} />
                <span>{t('percentageUnit')}</span>
              </label>
              <label className="gradebook-view-option">
                <input type="radio" name={`gradebook-unit-${classId}`} value="points" checked={viewOptions.categoryUnit === 'points'} onChange={() => updateViewOption({ categoryUnit: 'points' })} />
                <span>{t('pointsUnitShort')}</span>
              </label>
            </div>
          </div>
          <div className="gradebook-grid-actions" aria-label={t('gradebookActions')}>
            <button className="quick-entry-trigger" type="button" onClick={() => gridActions?.openQuickEntry()} disabled={!gridActions || !gridActions.canQuickEntry}><Icon name="edit" className="w-4 h-4" /><span>{t('quickEntry')}</span></button>
            <button className="btn-secondary text-sm" type="button" onClick={() => gridActions?.exportCSV()} disabled={!gridActions}><Icon name="reports" className="w-4 h-4" /><span>{t('csvExport')}</span></button>
            <button className="btn-primary text-sm" type="button" onClick={() => gridActions?.downloadGradebookPDF()} disabled={!gridActions}><Icon name="fileCheck" className="w-4 h-4" /><span>{t('downloadPdf')}</span></button>
          </div>
        </>}
      </div>

      {sub === 'grid' && <GradeMatrix classId={classId} className={className} viewOptions={viewOptions} key={refreshKey} onActionsChange={setGridActions} />}
      {sub === 'categories' && <CategoryManager classId={classId} refreshKey={refreshKey} onChange={() => setRefreshKey((k) => k + 1)} />}
    </div>
  );
}

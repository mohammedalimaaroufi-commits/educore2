import React, { useEffect, useState } from 'react';
import api from '../api/client';

export default function CommentPicker({ value, onChange, category = 'grade' }) {
  const [templates, setTemplates] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.get('/settings/comment-templates', { params: { category } }).then(({ data }) => setTemplates(data.templates));
  }, [category]);

  return (
    <div className="relative">
      <div className="flex gap-1">
        <input className="input text-xs py-1" placeholder="ملاحظة (اختياري)" value={value || ''} onChange={(e) => onChange(e.target.value)} />
        {templates.length > 0 && (
          <button type="button" className="text-xs text-primary border border-line rounded px-2" onClick={() => setOpen((o) => !o)}>▾</button>
        )}
      </div>
      {open && (
        <div className="absolute z-10 mt-1 w-56 max-h-40 overflow-y-auto bg-white border border-line rounded-lg shadow-lg text-xs">
          {templates.map((t) => (
            <button key={t.id} type="button" className="block w-full text-right px-3 py-2 hover:bg-surface"
              onClick={() => { onChange(t.text); setOpen(false); }}>
              {t.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

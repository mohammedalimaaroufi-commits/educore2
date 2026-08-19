import React, { useRef, useState } from 'react';
import api from '../api/client';

// Local backup — downloads a JSON snapshot of everything the teacher owns (classes, students,
// grades, behavior, attendance, schemes...) to their own device, and can restore from one.
// No cloud storage involved: the file goes straight to the browser's downloads folder.
export default function BackupManager() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const exportBackup = async () => {
    setExporting(true);
    setError('');
    try {
      const { data } = await api.get('/backup/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `educore-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMessage('تم تنزيل النسخة الاحتياطية ✓');
      setTimeout(() => setMessage(''), 3000);
    } catch {
      setError('تعذّر إنشاء النسخة الاحتياطية');
    } finally {
      setExporting(false);
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setError('');
    setMessage('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const { data } = await api.post('/backup/import', parsed);
      const c = data.counts;
      setMessage(`تمت الاستعادة ✓ — صفوف جديدة: ${c.classes}، طلاب: ${c.students}، درجات: ${c.grades}، سلوك: ${c.behaviorLogs}، حضور: ${c.attendanceRecords}`);
    } catch (err) {
      setError(err.response?.data?.error || 'الملف غير صالح كنسخة احتياطية لهذا التطبيق');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="card p-5">
      <h3 className="font-bold text-lg mb-1">نسخة احتياطية محلية</h3>
      <p className="text-xs text-ink/60 mb-4">
        احفظ نسخة من كل بياناتك (الصفوف، الطلاب، الدرجات، السلوك، الحضور) كملف واحد على جهازك، واستعدها لاحقًا أو على جهاز آخر. لا تُرفع أي بيانات لأي خادم خارجي — الملف ينزل مباشرة لجهازك.
      </p>

      <div className="flex flex-wrap gap-3 items-center">
        <button className="btn-primary text-sm" onClick={exportBackup} disabled={exporting}>
          {exporting ? 'جارٍ التجهيز...' : '⬇ تنزيل نسخة احتياطية'}
        </button>

        <label className="btn-secondary text-sm cursor-pointer">
          {importing ? 'جارٍ الاستعادة...' : '⬆ استعادة من ملف'}
          <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleFile} disabled={importing} />
        </label>
      </div>

      {message && <p className="text-primary text-sm mt-3">{message}</p>}
      {error && <p className="text-danger text-sm mt-3">{error}</p>}

      <p className="text-[11px] text-ink/40 mt-4">
        الاستعادة تضيف فقط ما هو غير موجود حاليًا — لن تُكرّر أو تحذف أي بيانات موجودة، لذا استيراد نفس الملف أكثر من مرة آمن تمامًا.
      </p>
    </div>
  );
}

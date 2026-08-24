import React, { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../context/LocaleContext.jsx';

export function useConfirmDialog() {
  const { t } = useLocale();
  const [request, setRequest] = useState(null);
  const confirm = useCallback((options = {}) => new Promise((resolve) => {
    setRequest({
      title: options.title || t('confirmAction'),
      message: options.message || t('confirmContinue'),
      confirmLabel: options.confirmLabel || t('confirm'),
      cancelLabel: options.cancelLabel || t('cancel'),
      danger: options.danger !== false,
      resolve,
    });
  }), [t]);
  const close = useCallback((value) => {
    setRequest((current) => {
      current?.resolve(Boolean(value));
      return null;
    });
  }, []);
  useEffect(() => {
    if (!request) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') close(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [request, close]);
  const dialog = request ? (
    <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(false); }}>
      <section className={`confirm-dialog ${request.danger ? 'confirm-dialog--danger' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <div className="confirm-dialog__icon" aria-hidden="true">{request.danger ? '!' : '✓'}</div>
        <div className="confirm-dialog__content"><h2 id="confirm-dialog-title">{request.title}</h2><p>{request.message}</p></div>
        <div className="confirm-dialog__actions"><button type="button" className="btn-secondary" onClick={() => close(false)}>{request.cancelLabel}</button><button type="button" className={request.danger ? 'btn-danger' : 'btn-primary'} onClick={() => close(true)}>{request.confirmLabel}</button></div>
      </section>
    </div>
  ) : null;
  return { confirm, confirmDialog: dialog };
}

export function useTextDialog() {
  const { t } = useLocale();
  const [request, setRequest] = useState(null);
  const askText = useCallback((options = {}) => new Promise((resolve) => {
    setRequest({
      title: options.title || t('enterNote'),
      message: options.message || '',
      placeholder: options.placeholder || '',
      confirmLabel: options.confirmLabel || t('save'),
      cancelLabel: options.cancelLabel || t('cancel'),
      value: options.defaultValue || '',
      resolve,
    });
  }), [t]);
  const close = useCallback((submitted, value = '') => {
    setRequest((current) => {
      current?.resolve(submitted ? value : null);
      return null;
    });
  }, []);
  useEffect(() => {
    if (!request) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') close(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [request, close]);
  const dialog = request ? (
    <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(false); }}>
      <form className="confirm-dialog confirm-dialog--form" role="dialog" aria-modal="true" onSubmit={(event) => { event.preventDefault(); close(true, event.currentTarget.elements.namedItem('dialog-note').value); }}>
        <div className="confirm-dialog__icon" aria-hidden="true">✎</div>
        <div className="confirm-dialog__content"><h2>{request.title}</h2><p>{request.message}</p></div>
        <textarea name="dialog-note" className="input confirm-dialog__input" rows="3" placeholder={request.placeholder} defaultValue={request.value} autoFocus />
        <div className="confirm-dialog__actions"><button type="button" className="btn-secondary" onClick={() => close(false)}>{request.cancelLabel}</button><button type="submit" className="btn-primary">{request.confirmLabel}</button></div>
      </form>
    </div>
  ) : null;
  return { askText, textDialog: dialog };
}

export default function ConfirmDialog({ children }) { return children || null; }

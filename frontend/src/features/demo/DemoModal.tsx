import { useEffect, useId, useRef, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';

// CampusConnect Modal geometry/control treatment; native dialog adds modal isolation.
export function DemoModal({ title, onClose, children }: PropsWithChildren<{ title: string; onClose: () => void }>) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    return () => { dialog?.close(); document.body.style.overflow = overflow; if (opener?.isConnected) opener.focus(); else document.querySelector<HTMLElement>('main')?.focus(); };
  }, []);
  return createPortal(<dialog ref={ref} className="md-demo-dialog cc-modal" aria-labelledby={titleId} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    const first = controls[0]; const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <header className="md-demo-dialog-head"><div><p className="cc-eyebrow">Local demonstration</p><h2 id={titleId} className="cc-section-title">{title}</h2></div><button className="cc-button cc-button--ghost" aria-label="Close dialog" onClick={onClose}><Icon name="close" className="size-5" /></button></header>
    {children}
  </dialog>, document.querySelector('.cc-app-shell') ?? document.body);
}

import { useEffect, useId, useRef, type PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';

// CampusConnect ui.tsx Modal controls and responsive bottom-sheet geometry.
// Native top-layer isolation keeps the workspace navigation and skip link inert.
export function MedicineCatalogDialog({ title, onClose, children }: PropsWithChildren<{ title: string; onClose: () => void }>) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const pointerOutside = useRef(false);
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { scrollX, scrollY } = window;
    const body = document.body;
    const saved = { overflow: body.style.overflow, position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width };
    const rootOverflow = document.documentElement.style.overflow;
    Object.assign(body.style, { overflow: 'hidden', position: 'fixed', top: `${-scrollY}px`, left: `${-scrollX}px`, width: '100%' });
    document.documentElement.style.overflow = 'hidden';
    const viewport = window.visualViewport;
    const fit = () => {
      dialog.style.setProperty('--catalog-vv-width', `${viewport?.width ?? innerWidth}px`);
      dialog.style.setProperty('--catalog-vv-height', `${viewport?.height ?? innerHeight}px`);
      dialog.style.setProperty('--catalog-vv-top', `${viewport?.offsetTop ?? 0}px`);
      dialog.style.setProperty('--catalog-vv-left', `${viewport?.offsetLeft ?? 0}px`);
    };
    fit();
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', fit);
    window.addEventListener('resize', fit);
    return () => {
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
      dialog.close();
      Object.assign(body.style, saved);
      document.documentElement.style.overflow = rootOverflow;
      window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
    };
  }, []);
  const outside = (event: { currentTarget: HTMLDialogElement; clientX: number; clientY: number }) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  };
  return createPortal(<dialog ref={ref} className="md-demo-dialog md-catalog-dialog cc-modal" aria-modal="true" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onPointerDown={event => { pointerOutside.current = event.target === event.currentTarget && outside(event); }}
    onClick={event => { if (pointerOutside.current && event.target === event.currentTarget && outside(event)) onClose(); pointerOutside.current = false; }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <header className="md-demo-dialog-head"><div><p className="cc-eyebrow">Local demonstration</p><h2 id={titleId} className="cc-section-title">{title}</h2></div><button type="button" className="cc-icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" className="size-5" /></button></header>
    <div className="md-catalog-dialog-content">{children}</div>
  </dialog>, document.querySelector('.cc-app-shell') ?? document.body);
}

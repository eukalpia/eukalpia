import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface PanelProps {
  className: string;
  eyebrow: string;
  title: string;
  onClose(): void;
  children: ReactNode;
}

/** v1's modal shell: a native dialog closed by Escape, the backdrop or the close button. */
export function Panel({ className, eyebrow, title, onClose, children }: PanelProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Older browsers (and jsdom) have no showModal: the dialog still opens, just not modal.
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (typeof dialog.close === 'function') dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`panel ${className}`}
      aria-labelledby={titleId}
      onCancel={e => {
        e.preventDefault();
        onClose();
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="panel-content">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button className="icon-button" aria-label="Close panel" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

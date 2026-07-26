import { useEffect, useRef, useState } from 'react';
import { useOverlay } from '../space/overlay';

/**
 * Simple centered modal with light-dismiss via Escape. Raises the chrome
 * above the page views while open (no-op in the manager window, which has
 * none). With `local`, the modal centers over its nearest positioned
 * ancestor (e.g. one section's home view) instead of the whole window.
 */
export function Modal({
  title,
  children,
  onDismiss,
  local = false,
  className
}: {
  title: string;
  children: React.ReactNode;
  onDismiss: () => void;
  local?: boolean;
  className?: string;
}): React.JSX.Element {
  const overlay = useOverlay();

  useEffect(() => {
    overlay.acquire();
    return () => overlay.release();
  }, [overlay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div className={`overlay overlay-dim${local ? ' overlay-local' : ''}`} onMouseDown={onDismiss}>
      <div
        className={className ? `modal ${className}` : 'modal'}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

/** Name prompt used by "New space" and "Rename". */
export function NamePrompt({
  title,
  initial,
  submitLabel,
  onSubmit,
  onCancel
}: {
  title: string;
  initial: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const submit = (): void => {
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <Modal title={title} onDismiss={onCancel}>
      <input
        ref={inputRef}
        className="text-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <div className="modal-buttons">
        <button className="button primary" onClick={submit} disabled={!name.trim()}>
          {submitLabel}
        </button>
        <button className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

/** Confirmation dialog (e.g. Delete space). */
export function Confirm({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <Modal title={title} onDismiss={onCancel}>
      <div className="modal-message">{message}</div>
      <div className="modal-buttons">
        <button className="button danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

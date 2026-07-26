import { useEffect, useRef, useState } from 'react';
import { Modal } from '../components/Modal';

/** Add/Edit home link dialog: URL and title; icon is auto-fetched from the favicon. */
export function LinkDialog({
  title,
  initialTitle,
  initialUrl,
  onSubmit,
  onCancel
}: {
  title: string;
  initialTitle: string;
  initialUrl: string;
  onSubmit: (title: string, url: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [linkTitle, setLinkTitle] = useState(initialTitle);
  const [url, setUrl] = useState(initialUrl);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const submit = (): void => {
    if (url.trim()) onSubmit(linkTitle.trim(), url.trim());
  };

  return (
    // local: centers over this section's home view, not the window — the
    // other section may be showing a page.
    <Modal title={title} onDismiss={onCancel} local>
      <div className="link-dialog-fields">
        <label className="field-label" htmlFor="link-title">
          Title
        </label>
        <input
          id="link-title"
          ref={titleRef}
          className="text-input"
          value={linkTitle}
          onChange={(e) => setLinkTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <label className="field-label" htmlFor="link-url">
          URL
        </label>
        <input
          id="link-url"
          className="text-input"
          value={url}
          placeholder="https://…"
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
      <div className="modal-buttons">
        <button className="button primary" onClick={submit} disabled={!url.trim()}>
          Save
        </button>
        <button className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

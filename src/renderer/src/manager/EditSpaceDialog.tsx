import { useEffect, useRef, useState } from 'react';
import { COLOR_SCHEMES } from '@shared/color-schemes';
import { Modal } from '../components/Modal';
import { washVars } from '../wash';

/** A space's editable properties: its name and its backdrop color scheme. */
export function EditSpaceDialog({
  name: initialName,
  colorScheme: initialScheme,
  onSubmit,
  onCancel
}: {
  name: string;
  colorScheme: string;
  onSubmit: (name: string, colorScheme: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(initialName);
  const [scheme, setScheme] = useState(initialScheme);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const submit = (): void => {
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed, scheme);
  };

  return (
    <Modal title="Edit space" onDismiss={onCancel}>
      <label className="field-label" htmlFor="edit-space-name">
        Name
      </label>
      <input
        id="edit-space-name"
        ref={inputRef}
        className="text-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />

      <span className="field-label edit-space-color">Color</span>
      <div className="wash-swatches">
        {COLOR_SCHEMES.map((s) => (
          <button
            key={s.id}
            className={s.id === scheme ? 'wash-swatch selected' : 'wash-swatch'}
            title={s.name}
            aria-label={s.name}
            aria-pressed={s.id === scheme}
            style={washVars(s.id)}
            onClick={() => setScheme(s.id)}
          />
        ))}
      </div>

      <div className="modal-buttons">
        <button className="button primary" onClick={submit} disabled={!name.trim()}>
          Save
        </button>
        <button className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

import { useState } from 'react';
import { Modal } from '../components/Modal';

interface ScreenShareSourceDto {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string | null;
}

export interface ScreenSharePromptDto {
  origin: string;
  sources: ScreenShareSourceDto[];
  systemPicker: boolean;
}

/**
 * The screen-share picker. Two shapes, decided by the main process: a grid of
 * screens and windows to choose from, or — where the desktop's own portal does
 * the picking (Wayland) — just the question of which kind to share, since
 * nothing can be listed before the portal opens.
 *
 * The answer is a source id, or a kind in the portal case, and null to
 * decline; the main process knows which it asked for.
 */
export function ScreenShareDialog({
  prompt,
  onAnswer
}: {
  prompt: ScreenSharePromptDto;
  onAnswer: (choice: string | null) => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'screen' | 'window'>('screen');

  const asked = (
    <p className="screen-share-ask">
      <strong>{prompt.origin}</strong> wants to share your screen.
    </p>
  );

  if (prompt.systemPicker) {
    return (
      <Modal title="Share your screen" onDismiss={() => onAnswer(null)}>
        {asked}
        <p className="modal-message">Your desktop will ask which one to share.</p>
        <div className="modal-buttons">
          <button className="button primary" onClick={() => onAnswer('screen')}>
            Entire screen
          </button>
          <button className="button" onClick={() => onAnswer('window')}>
            A window
          </button>
          <button className="button" onClick={() => onAnswer(null)}>
            Cancel
          </button>
        </div>
      </Modal>
    );
  }

  const shown = prompt.sources.filter((s) => s.kind === tab);

  return (
    <Modal
      title="Share your screen"
      onDismiss={() => onAnswer(null)}
      className="screen-share-dialog"
    >
      {asked}
      <div className="screen-share-tabs">
        <button
          className={tab === 'screen' ? 'button small primary' : 'button small'}
          onClick={() => setTab('screen')}
        >
          Screens
        </button>
        <button
          className={tab === 'window' ? 'button small primary' : 'button small'}
          onClick={() => setTab('window')}
        >
          Windows
        </button>
      </div>
      <div className="screen-share-grid">
        {shown.map((source) => (
          <button
            key={source.id}
            className={source.id === selected ? 'screen-share-item selected' : 'screen-share-item'}
            onClick={() => setSelected(source.id)}
            onDoubleClick={() => onAnswer(source.id)}
            title={source.name}
          >
            {source.thumbnail ? (
              <img src={source.thumbnail} alt="" />
            ) : (
              <div className="screen-share-blank" />
            )}
            <span className="screen-share-name">{source.name}</span>
          </button>
        ))}
        {shown.length === 0 && (
          <div className="modal-message">
            {tab === 'screen' ? 'No screens available.' : 'No open windows to share.'}
          </div>
        )}
      </div>
      <div className="modal-buttons">
        <button
          className="button primary"
          disabled={!selected}
          onClick={() => selected && onAnswer(selected)}
        >
          Share
        </button>
        <button className="button" onClick={() => onAnswer(null)}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

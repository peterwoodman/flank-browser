import { useEffect, useState } from 'react';
import type { BrowserScanDto, ImportResultDto } from '@shared/ipc-types';
import { Modal } from '../components/Modal';
import { invoke } from '../ipc';

/**
 * Picker for importing extensions out of other Chromium browsers
 * (docs/behaviors.md → Extensions). Scans on open, since the answer depends on
 * what the other browsers have installed right now.
 */
export function ImportExtensionsDialog({
  onClose
}: {
  onClose: (imported: boolean) => void;
}): React.JSX.Element {
  const [scan, setScan] = useState<BrowserScanDto | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void invoke<BrowserScanDto>('extensions:scanBrowsers').then((result) => {
      if (!cancelled) setScan(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const runImport = (): void => {
    setImporting(true);
    void invoke<ImportResultDto>('extensions:import', [...selected]).then((result) => {
      if (result.errors.length > 0) {
        setImporting(false);
        setError(`Could not copy: ${result.errors.join(', ')}.`);
        return;
      }
      onClose(result.imported > 0);
    });
  };

  return (
    <Modal title="Import extensions" onDismiss={() => onClose(false)} className="modal-import">
      {!scan && <div className="settings-hint">Looking for installed browsers…</div>}

      {scan && scan.extensions.length === 0 && (
        <div className="modal-message">
          {scan.browsers.length === 0
            ? 'No other Chromium browsers were found on this computer.'
            : `No extensions were found in ${scan.browsers.join(', ')}.`}
        </div>
      )}

      {scan && scan.extensions.length > 0 && (
        <>
          <div className="modal-message">
            Found in {scan.browsers.join(', ')}. Each one is copied into Flank and loads
            the next time Flank starts; later changes in the other browser won&apos;t
            affect it. Support is partial — an extension that relies on APIs Flank&apos;s
            engine doesn&apos;t implement may not work.
          </div>
          <div className="import-list">
            {scan.extensions.map((ext) => (
              <label
                key={ext.extensionId}
                className={ext.alreadyAdded ? 'import-row is-added' : 'import-row'}
              >
                <input
                  type="checkbox"
                  disabled={ext.alreadyAdded || importing}
                  checked={selected.has(ext.extensionId)}
                  onChange={() => toggle(ext.extensionId)}
                />
                {ext.icon ? (
                  <img className="import-icon" src={ext.icon} alt="" />
                ) : (
                  <span className="import-icon" />
                )}
                <span className="import-text">
                  <span className="import-name">{ext.name}</span>
                  <span className="import-source">
                    {ext.alreadyAdded ? 'Already added' : `${ext.source} · ${ext.version}`}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </>
      )}

      {error && <div className="settings-error">{error}</div>}

      <div className="modal-buttons">
        <button
          className="button primary"
          disabled={selected.size === 0 || importing}
          onClick={runImport}
        >
          {importing ? 'Importing…' : `Import ${selected.size || ''}`.trim()}
        </button>
        <button className="button" onClick={() => onClose(false)} disabled={importing}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

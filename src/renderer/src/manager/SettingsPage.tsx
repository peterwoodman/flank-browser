import { useEffect, useState } from 'react';
import type { AppSettings, OneShotStart, ToolbarPosition } from '@shared/types';
import { invoke } from '../ipc';
import { ImportExtensionsDialog } from './ImportExtensionsDialog';

/**
 * Settings behind the Manager's gear: search/suggest URL templates,
 * launch-at-login, toolbar position, background tab timeout, the 1-shot
 * window's start page, and extension management.
 * Extension changes take effect after an app restart.
 */
export function SettingsPage({
  settings,
  onChanged
}: {
  settings: AppSettings;
  onChanged: () => void;
}): React.JSX.Element {
  const [searchTemplate, setSearchTemplate] = useState(settings.searchTemplate);
  const [suggestTemplate, setSuggestTemplate] = useState(settings.suggestTemplate);
  const [tabMinutes, setTabMinutes] = useState(String(settings.backgroundTabMinutes));
  const [oneShotUrl, setOneShotUrl] = useState(settings.oneShotStartUrl);
  const [extError, setExtError] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    setSearchTemplate(settings.searchTemplate);
    setSuggestTemplate(settings.suggestTemplate);
    setTabMinutes(String(settings.backgroundTabMinutes));
    setOneShotUrl(settings.oneShotStartUrl);
  }, [settings]);

  const commitTemplates = (): void => {
    void invoke('settings:update', { searchTemplate, suggestTemplate }).then(onChanged);
  };

  const commitTabMinutes = (): void => {
    const minutes = parseInt(tabMinutes, 10);
    if (Number.isFinite(minutes) && minutes >= 1) {
      void invoke('settings:update', { backgroundTabMinutes: minutes }).then(onChanged);
    } else {
      setTabMinutes(String(settings.backgroundTabMinutes));
    }
  };

  // Refused rather than stored if it isn't an http(s) address (main validates
  // it too, since a 1-shot window is navigated there by the host).
  const commitOneShotUrl = (): void => {
    void invoke('settings:update', { oneShotStartUrl: oneShotUrl }).then(onChanged);
  };

  return (
    <div className="settings-page">
      <section>
        <label className="field-label" htmlFor="search-template">
          Search engine URL template ({'{query}'} is replaced)
        </label>
        <input
          id="search-template"
          className="text-input"
          value={searchTemplate}
          onChange={(e) => setSearchTemplate(e.target.value)}
          onBlur={commitTemplates}
          spellCheck={false}
        />
      </section>

      <section>
        <label className="field-label" htmlFor="suggest-template">
          Search suggestions URL template (empty disables remote suggestions)
        </label>
        <input
          id="suggest-template"
          className="text-input"
          value={suggestTemplate}
          onChange={(e) => setSuggestTemplate(e.target.value)}
          onBlur={commitTemplates}
          spellCheck={false}
        />
      </section>

      <section className="field-row">
        <label htmlFor="launch-at-login">Launch at login</label>
        <input
          id="launch-at-login"
          type="checkbox"
          checked={settings.launchAtLogin}
          onChange={(e) => void invoke('settings:update', { launchAtLogin: e.target.checked }).then(onChanged)}
        />
      </section>

      <section className="field-row">
        <label htmlFor="toolbar-position">Toolbar position</label>
        <select
          id="toolbar-position"
          className="select-input"
          value={settings.toolbarPosition}
          onChange={(e) =>
            void invoke('settings:update', {
              toolbarPosition: e.target.value as ToolbarPosition
            }).then(onChanged)
          }
        >
          <option value="side">Left Side</option>
          <option value="top">Top</option>
        </select>
      </section>

      <section className="field-row">
        <label htmlFor="tab-minutes">Background tab timeout (minutes)</label>
        <input
          id="tab-minutes"
          className="text-input number-input"
          value={tabMinutes}
          onChange={(e) => setTabMinutes(e.target.value)}
          onBlur={commitTabMinutes}
          inputMode="numeric"
        />
      </section>

      <section className="field-row">
        <label htmlFor="oneshot-start">1-shot window opens on</label>
        <select
          id="oneshot-start"
          className="select-input"
          value={settings.oneShotStart}
          onChange={(e) =>
            void invoke('settings:update', {
              oneShotStart: e.target.value as OneShotStart
            }).then(onChanged)
          }
        >
          <option value="blank">Empty page</option>
          <option value="search">Search engine home page</option>
          <option value="custom">A page of my own</option>
        </select>
      </section>

      {settings.oneShotStart === 'custom' && (
        <section>
          <label className="field-label" htmlFor="oneshot-url">
            1-shot window start page
          </label>
          <input
            id="oneshot-url"
            className="text-input"
            value={oneShotUrl}
            placeholder="https://example.com"
            onChange={(e) => setOneShotUrl(e.target.value)}
            onBlur={commitOneShotUrl}
            spellCheck={false}
          />
        </section>
      )}

      <section>
        <div className="field-label">Extensions (changes apply after restart)</div>
        {settings.extensions.length === 0 && (
          <div className="settings-hint">No extensions added.</div>
        )}
        {settings.extensions.map((ext) => (
          <div key={ext.id} className="extension-row">
            <input
              type="checkbox"
              checked={ext.enabled}
              title={ext.enabled ? 'Enabled' : 'Disabled'}
              onChange={(e) => void invoke('extensions:toggle', ext.id, e.target.checked).then(onChanged)}
            />
            <span className="extension-name" title={ext.path}>
              {ext.name}
            </span>
            <button
              className="button small"
              onClick={() => void invoke('extensions:remove', ext.id).then(onChanged)}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="settings-buttons">
          <button
            className="button"
            onClick={() =>
              void invoke<{ ok: boolean; error?: string }>('extensions:add').then((r) => {
                setExtError(r.error ?? '');
                if (r.ok) onChanged();
              })
            }
          >
            Add unpacked extension folder…
          </button>
          <button
            className="button"
            onClick={() => {
              setExtError('');
              setImporting(true);
            }}
          >
            Import from another browser…
          </button>
        </div>
        {extError && <div className="settings-error">{extError}</div>}
      </section>

      {importing && (
        <ImportExtensionsDialog
          onClose={(imported) => {
            setImporting(false);
            if (imported) onChanged();
          }}
        />
      )}
    </div>
  );
}

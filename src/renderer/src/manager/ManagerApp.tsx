import { useCallback, useEffect, useState } from 'react';
import type { ManagerState } from '@shared/ipc-types';
import { invoke, on } from '../ipc';
import { SpaceGrid } from './SpaceGrid';
import { SettingsPage } from './SettingsPage';
import './manager.css';

/**
 * The Manager window: the app's launcher (space tiles, grouped by profile) with
 * the settings page behind the title-bar gear (the gear becomes a back arrow
 * while open).
 */
export function ManagerApp(): React.JSX.Element {
  const [state, setState] = useState<ManagerState | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const refresh = useCallback(async () => {
    setState(await invoke<ManagerState>('manager:getState'));
  }, []);

  useEffect(() => {
    void refresh();
    return on('manager:refresh', () => void refresh());
  }, [refresh]);

  return (
    <div className="manager-root">
      <header className="titlebar">
        <span className="titlebar-title">Flank</span>
        <button
          className="icon-button titlebar-button"
          title={showSettings ? 'Back' : 'Settings'}
          onClick={() => setShowSettings((v) => !v)}
        >
          {showSettings ? '\u2190' : '\u2699'}
        </button>
      </header>
      <main className="manager-content">
        {state === null ? null : showSettings ? (
          <SettingsPage settings={state.settings} onChanged={refresh} />
        ) : (
          <SpaceGrid profiles={state.profiles} onChanged={refresh} />
        )}
      </main>
      <footer className="manager-version">{state === null ? '' : `v${state.version}`}</footer>
    </div>
  );
}

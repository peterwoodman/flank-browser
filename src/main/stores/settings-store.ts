import { AppSettings, defaultSettings } from '@shared/types';
import { settingsFile } from '../paths';
import { loadJson, saveJson } from './json-file';

/** App-wide settings; saves immediately on change. */
class SettingsStore {
  current: AppSettings = defaultSettings();

  load(): void {
    this.current = loadJson(settingsFile, defaultSettings);
  }

  save(): void {
    saveJson(settingsFile, this.current);
  }

  update(mutate: (s: AppSettings) => void): void {
    mutate(this.current);
    this.save();
  }
}

export const settingsStore = new SettingsStore();

import { SessionFile, defaultSessionFile } from '@shared/types';
import { sessionFilePath } from '../paths';
import { loadJson, saveJson } from './json-file';

/** Per-space session state under sessions/{spaceId}.json. */
export function loadSession(spaceId: string): SessionFile {
  return loadJson(sessionFilePath(spaceId), defaultSessionFile);
}

export function saveSession(spaceId: string, session: SessionFile): void {
  session.savedAt = new Date().toISOString();
  saveJson(sessionFilePath(spaceId), session);
}

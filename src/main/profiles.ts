import { Session } from 'electron';
import fs from 'fs';
import { Profile, Space } from '@shared/types';
import { browsingSession, createdSession } from './browser-session';
import { extensionsReady } from './extensions';
import { spacesStore } from './stores/spaces-store';
import { partitionDir } from './paths';
import { logError } from './log';

/**
 * Ties spaces to the browser profile they browse as (docs/behaviors.md →
 * Profiles). A profile's partition is created the first time one of its spaces
 * opens, so nothing is set up for a profile that is never used.
 */

/** The session a space's pages browse in: its profile's own partition. */
export function sessionForSpace(space: Space): Session {
  return browsingSession(spacesStore.profileOf(space).partition);
}

/** The same session, once the profile's extensions are loaded into it. */
export async function readySessionForSpace(space: Space): Promise<Session> {
  const ses = sessionForSpace(space);
  await extensionsReady(ses);
  return ses;
}

/**
 * Throws away a removed profile's browsing data. Clearing through the session
 * is what actually empties it: Chromium keeps the partition's files open for
 * the rest of the run, so the folder itself often only goes on a later launch —
 * or, for a profile never opened this run, right here.
 */
export async function discardProfileData(profile: Profile): Promise<void> {
  const ses = createdSession(profile.partition);
  // A session knows its own folder; a profile never opened this run has none,
  // so fall back to where the engine puts a partition of that name.
  let folder = partitionDir(profile.partition);
  if (ses) {
    folder = ses.getStoragePath() ?? folder;
    await ses.clearStorageData();
    await ses.clearCache();
  }
  try {
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  } catch (err) {
    logError(`profile data removal (${profile.name})`, err);
  }
}

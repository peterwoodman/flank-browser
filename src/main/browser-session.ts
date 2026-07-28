import { session, Session } from 'electron';

/**
 * The browsing sessions pages run in: one persistent Chromium partition per
 * profile, so cookies, logins, and cache are shared by the spaces inside a
 * profile and separate between profiles (docs/architecture.md → Profiles).
 */

/**
 * The partition Flank used while it had a single profile. The first profile
 * keeps it, so gaining profiles doesn't sign the user out of everything.
 */
export const FIRST_PARTITION = 'persist:flank';

export function partitionFor(profileId: string): string {
  return `persist:flank-${profileId}`;
}

const sessions = new Map<string, Session>();

type Preparer = (ses: Session) => void;
const preparers: Preparer[] = [];

/**
 * Registers session-scoped setup — permissions, downloads, screen share,
 * extensions. A partition is created the first time one of its spaces opens,
 * so none of that can be installed once at startup the way it could with a
 * single profile: this runs `prepare` on the sessions that already exist and
 * on every one created afterwards.
 */
export function prepareEverySession(prepare: Preparer): void {
  preparers.push(prepare);
  for (const ses of sessions.values()) prepare(ses);
}

export function browsingSession(partition: string): Session {
  const cached = sessions.get(partition);
  if (cached) return cached;

  const ses = session.fromPartition(partition);
  sessions.set(partition, ses);
  for (const prepare of preparers) prepare(ses);
  return ses;
}

/** The session for this partition if one was created this run, for clearing a removed profile's data. */
export function createdSession(partition: string): Session | undefined {
  return sessions.get(partition);
}

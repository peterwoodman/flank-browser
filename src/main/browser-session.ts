import { session, Session } from 'electron';

/**
 * The one shared browser profile: all content views in every space use this
 * persistent partition, so cookies, logins, and cache are shared app-wide
 * (docs/architecture — spaces share one profile by design).
 */
export const FLANK_PARTITION = 'persist:flank';

let cached: Session | null = null;

export function flankSession(): Session {
  cached ??= session.fromPartition(FLANK_PARTITION);
  return cached;
}

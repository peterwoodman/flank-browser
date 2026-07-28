import { ManagerApp } from './manager/ManagerApp';
import { SpaceApp } from './space/SpaceApp';
import { OneShotApp } from './space/OneShotApp';

/**
 * One renderer bundle serves every Flank chrome surface; the hash picks the
 * page: `#manager` (the Manager window), `#space/<windowId>` (a space window's
 * chrome view), or `#oneshot/<windowId>` (a 1-shot window's).
 */
export function App(): React.JSX.Element {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash.startsWith('space/')) {
    return <SpaceApp windowId={hash.slice('space/'.length)} />;
  }
  if (hash.startsWith('oneshot/')) {
    return <OneShotApp windowId={hash.slice('oneshot/'.length)} />;
  }
  return <ManagerApp />;
}

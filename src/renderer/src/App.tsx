import { ManagerApp } from './manager/ManagerApp';
import { SpaceApp } from './space/SpaceApp';

/**
 * One renderer bundle serves every Flank chrome surface; the hash picks the
 * page: `#manager` (the Manager window) or `#space/<windowId>` (a space
 * window's chrome view).
 */
export function App(): React.JSX.Element {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash.startsWith('space/')) {
    return <SpaceApp windowId={hash.slice('space/'.length)} />;
  }
  return <ManagerApp />;
}

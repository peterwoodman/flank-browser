import { WebContents } from 'electron';
import { prepareEverySession } from './browser-session';
import { newId } from './ids';
import { log } from './log';

export interface DownloadNotice {
  id: string;
  filename: string;
  state: 'started' | 'completed' | 'failed';
}

/** Routes a download notice to the window that triggered it. */
type NotifyFn = (contents: WebContents, notice: DownloadNotice) => void;

/**
 * Downloads (docs/behaviors.md): files save straight to the OS Downloads
 * folder without prompting; a transient toast reports start and finish.
 * There is deliberately no download manager.
 */
export function installDownloadHandler(notify: NotifyFn): void {
  prepareEverySession((ses) => {
    ses.on('will-download', (_event, item, contents) => {
      const id = newId();
      const filename = item.getFilename();
      notify(contents, { id, filename, state: 'started' });

      item.once('done', (_e, state) => {
        log(`download ${state}: ${filename}`);
        notify(contents, { id, filename, state: state === 'completed' ? 'completed' : 'failed' });
      });
    });
  });
}

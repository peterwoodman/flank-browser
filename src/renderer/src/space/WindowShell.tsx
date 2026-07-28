import { useEffect, useState } from 'react';
import { on, send } from '../ipc';
import { OverlayContext, OverlayController } from './overlay';
import { ScreenShareDialog, ScreenSharePromptDto } from './ScreenShareDialog';

interface DownloadNotice {
  id: string;
  filename: string;
  state: 'started' | 'completed' | 'failed';
}

interface PermissionPromptDto {
  id: string;
  origin: string;
  permission: string;
  description: string;
}

/**
 * What every browsing window's chrome wears around its panes: the title bar
 * with its download pill, and the dialogs the main process raises on any page
 * (permissions, screen sharing). The panes themselves are the caller's.
 */
export function WindowShell({
  windowId,
  overlay,
  title,
  titlebarClassName = 'titlebar',
  titlebarStyle,
  rootStyle,
  children
}: {
  windowId: string;
  overlay: OverlayController;
  title: string;
  titlebarClassName?: string;
  titlebarStyle?: React.CSSProperties;
  rootStyle?: React.CSSProperties;
  children: React.ReactNode;
}): React.JSX.Element {
  // Download toast (start/done); terminal states linger briefly then clear.
  const [downloads, setDownloads] = useState<DownloadNotice[]>([]);
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const off = on('space:download', (...args) => {
      const notice = args[0] as DownloadNotice;
      setDownloads((prev) => [...prev.filter((d) => d.id !== notice.id), notice]);
      if (notice.state !== 'started') {
        timers.push(
          setTimeout(() => setDownloads((prev) => prev.filter((d) => d.id !== notice.id)), 4000)
        );
      }
    });
    return () => {
      off();
      for (const t of timers) clearTimeout(t);
    };
  }, []);

  // Permission prompts arrive one at a time (serialized in main); each holds
  // the overlay so the dialog paints above the page that asked.
  const [permissionPrompt, setPermissionPrompt] = useState<PermissionPromptDto | null>(null);
  useEffect(() => {
    return on('space:permissionPrompt', (...args) => {
      setPermissionPrompt(args[0] as PermissionPromptDto);
    });
  }, []);
  useEffect(() => {
    if (!permissionPrompt) return;
    overlay.acquire();
    return () => overlay.release();
  }, [permissionPrompt, overlay]);

  const answerPermission = (allow: boolean): void => {
    if (!permissionPrompt) return;
    send('permission:respond', windowId, permissionPrompt.id, allow);
    setPermissionPrompt(null);
  };

  // Screen sharing: main sends the sources it could enumerate (none where the
  // desktop portal picks) and waits for one answer per request.
  const [sharePrompt, setSharePrompt] = useState<ScreenSharePromptDto | null>(null);
  useEffect(() => {
    return on('space:screenSharePrompt', (...args) => {
      setSharePrompt(args[0] as ScreenSharePromptDto);
    });
  }, []);

  const answerScreenShare = (choice: string | null): void => {
    send('screenShare:respond', windowId, choice);
    setSharePrompt(null);
  };

  const latest = downloads[downloads.length - 1];

  return (
    <OverlayContext.Provider value={overlay}>
      <div className="space-root" style={rootStyle}>
        <header className={titlebarClassName} style={titlebarStyle}>
          <span className="titlebar-title">{title}</span>
          {latest && (
            <span className="download-pill">
              {latest.state === 'started'
                ? `Downloading ${latest.filename}…`
                : latest.state === 'completed'
                  ? `Downloaded ${latest.filename}`
                  : `Download failed: ${latest.filename}`}
            </span>
          )}
        </header>
        {children}
        {permissionPrompt && (
          <div className="overlay overlay-dim">
            <div className="modal permission-dialog">
              <p>
                <strong>{permissionPrompt.origin}</strong> wants to use{' '}
                {permissionPrompt.description}.
              </p>
              <div className="modal-buttons">
                <button className="button primary" onClick={() => answerPermission(true)}>
                  Allow
                </button>
                <button className="button" onClick={() => answerPermission(false)}>
                  Block
                </button>
              </div>
            </div>
          </div>
        )}
        {sharePrompt && <ScreenShareDialog prompt={sharePrompt} onAnswer={answerScreenShare} />}
      </div>
    </OverlayContext.Provider>
  );
}

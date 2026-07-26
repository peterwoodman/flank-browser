import { desktopCapturer, webContents, WebContents } from 'electron';
import type { DesktopCapturerSource, Streams } from 'electron';
import { flankSession } from './browser-session';
import { screenCaptureUsesPortal } from './linux-platform';
import { log, logError } from './log';

/**
 * Screen sharing (docs/behaviors.md → Media, permissions, and dialogs).
 *
 * Electron ships no picker of its own: with no display-media handler
 * installed, every `getDisplayMedia()` call fails outright — which is what a
 * meeting site reports as "something went wrong when sharing your screen".
 * Flank picks the source and grants exactly that one. The choice is never
 * remembered, unlike the camera/mic decisions in `permissions.ts`: a capture
 * grant is too broad to hand out again without asking.
 *
 * Where the desktop captures through xdg-desktop-portal (Wayland), the
 * compositor owns the picker and nothing can be enumerated beforehand. Flank
 * then asks only which kind of source is wanted — and, more importantly,
 * names the site asking, which the portal's own dialog does not — before
 * handing over to the portal.
 */

export type ShareKind = 'screen' | 'window';

export interface ScreenShareSource {
  id: string;
  name: string;
  kind: ShareKind;
  /** Data URL preview, or null when the platform gave a blank one. */
  thumbnail: string | null;
}

export interface ScreenSharePrompt {
  origin: string;
  /** Empty in `systemPicker` mode, where the answer is a ShareKind instead. */
  sources: ScreenShareSource[];
  systemPicker: boolean;
}

/** Resolves to a source id — or a ShareKind in `systemPicker` mode — or null to deny. */
type PickFn = (contents: WebContents, prompt: ScreenSharePrompt) => Promise<string | null>;

const THUMBNAIL_SIZE = { width: 320, height: 180 };

export function installDisplayMediaHandler(pickFn: PickFn): void {
  flankSession().setDisplayMediaRequestHandler(
    (request, callback) => {
      const contents = request.frame ? webContents.fromFrame(request.frame) : undefined;
      if (!contents) {
        callback({});
        return;
      }
      const origin = originOf(request.securityOrigin);
      grant(contents, origin, request.audioRequested, pickFn)
        .catch((err) => {
          logError(`screen share for ${origin}`, err);
          return {} as Streams;
        })
        .then(callback);
    },
    // macOS 15+ has a system picker; when it is used this handler never runs.
    { useSystemPicker: true }
  );
}

async function grant(
  contents: WebContents,
  origin: string,
  audioRequested: boolean,
  pickFn: PickFn
): Promise<Streams> {
  const source = screenCaptureUsesPortal()
    ? await pickThroughPortal(contents, origin, pickFn)
    : await pickFromList(contents, origin, pickFn);

  if (!source) {
    log(`screen share for ${origin} cancelled`);
    return {};
  }
  log(`screen share for ${origin}: ${source.name}`);
  // Capturing system audio alongside the screen is Windows-only in Electron;
  // elsewhere the page gets video and keeps whatever mic it already had.
  return audioRequested && process.platform === 'win32'
    ? { video: source, audio: 'loopback' }
    : { video: source };
}

/** Flank's own picker: every screen and window, with previews. */
async function pickFromList(
  contents: WebContents,
  origin: string,
  pickFn: PickFn
): Promise<DesktopCapturerSource | null> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: THUMBNAIL_SIZE
  });
  const chosen = await pickFn(contents, {
    origin,
    systemPicker: false,
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL()
    }))
  });
  return sources.find((s) => s.id === chosen) ?? null;
}

/**
 * Portal path: asking for a kind opens the desktop's own capture dialog, and
 * what comes back is the single source the user agreed to share (nothing at
 * all if they dismissed it). Only one kind is requested per call because each
 * one opens a separate portal dialog.
 */
async function pickThroughPortal(
  contents: WebContents,
  origin: string,
  pickFn: PickFn
): Promise<DesktopCapturerSource | null> {
  const kind = await pickFn(contents, { origin, systemPicker: true, sources: [] });
  if (kind !== 'screen' && kind !== 'window') return null;
  const sources = await desktopCapturer.getSources({
    types: [kind],
    thumbnailSize: { width: 0, height: 0 }
  });
  const source = sources[0] ?? null;
  if (!source) {
    log('the desktop portal granted no source: dismissed, or no ScreenCast backend installed');
  }
  return source;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

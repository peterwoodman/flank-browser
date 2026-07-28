import { Session, WebContents } from 'electron';
import { prepareEverySession } from './browser-session';
import { settingsStore } from './stores/settings-store';
import { log } from './log';

/**
 * Web permission prompts (docs/behaviors.md → Media and permissions): the
 * engine allows by default, so every request goes through Flank. Decisions
 * are remembered per origin+permission in settings (the engine itself has no
 * persistence), and dialogs are serialized so overlapping requests can't
 * stack.
 *
 * Requests are only half of it. Most web APIs check the permission first and
 * only request when the check says no, and checks are a separate handler the
 * engine also answers "allow" to by default — so both are installed here, from
 * the same policy, or a page could read a capability as granted that Flank
 * never granted.
 *
 * Answers are remembered app-wide rather than per profile: allowing a site your
 * camera is a decision about that site, not about which identity is browsing it.
 */

/** Permissions that get an explicit prompt; the rest resolve silently. */
const PROMPTED = new Set([
  'media',
  'geolocation',
  'notifications',
  'clipboard-read',
  'clipboard-sanitized-write',
  'midi',
  'midiSysex',
  'pointerLock',
  'openExternal'
]);

/**
 * Harmless engine plumbing that would be noise as a dialog. `display-capture`
 * belongs here because the screen-share picker (`screen-share.ts`) is that
 * request's real consent step; `screen-wake-lock` is what a video call uses to
 * keep the display on while nobody touches the keyboard; `mediaKeySystem` is
 * the DRM handshake protected video needs before it will play at all, and a
 * dialog about it would mean nothing to the person answering it.
 */
const SILENTLY_ALLOWED = new Set([
  'fullscreen',
  'persistent-storage',
  'background-sync',
  'display-capture',
  'screen-wake-lock',
  'mediaKeySystem'
]);

export interface PermissionPrompt {
  origin: string;
  permission: string;
  description: string;
}

/** Shows the dialog in the requesting page's window; resolves to allow/deny. */
type PromptFn = (contents: WebContents, prompt: PermissionPrompt) => Promise<boolean>;

let queue: Promise<void> = Promise.resolve();

export function installPermissionHandler(promptFn: PromptFn): void {
  prepareEverySession((ses) => {
    installCheckHandler(ses);

    ses.setPermissionRequestHandler((contents, permission, callback, details) => {
      const origin = originOf(details.requestingUrl);

      if (SILENTLY_ALLOWED.has(permission)) {
        callback(true);
        return;
      }
      if (!PROMPTED.has(permission) || !origin || !contents) {
        log(`permission ${permission} from ${origin || '?'} denied (not promptable)`);
        callback(false);
        return;
      }

      const remembered = settingsStore.current.permissions?.[origin]?.[permission];
      if (remembered !== undefined) {
        callback(remembered);
        return;
      }

      // One dialog at a time, app-wide.
      queue = queue.then(async () => {
        const again = settingsStore.current.permissions?.[origin]?.[permission];
        if (again !== undefined) {
          callback(again);
          return;
        }
        let allowed = false;
        try {
          allowed = await promptFn(contents, {
            origin,
            permission,
            description: describe(permission)
          });
        } catch {
          allowed = false;
        }
        settingsStore.update((s) => {
          s.permissions ??= {};
          s.permissions[origin] ??= {};
          s.permissions[origin][permission] = allowed;
        });
        callback(allowed);
      });
    });
  });
}

/**
 * Answers the engine's silent permission checks (`navigator.permissions.query`,
 * `Notification.permission`, device-label access) from the same policy the
 * dialog uses. A check cannot show a dialog, so anything not yet decided
 * answers no and the request handler prompts when the page actually asks for
 * it — which is the sequence those APIs already follow.
 */
function installCheckHandler(ses: Session): void {
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    if (SILENTLY_ALLOWED.has(permission)) return true;
    const origin =
      originOf(requestingOrigin) ||
      originOf(details.requestingUrl ?? '') ||
      originOf(details.securityOrigin ?? '');
    if (!PROMPTED.has(permission) || !origin) return false;
    return settingsStore.current.permissions?.[origin]?.[permission] === true;
  });
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function describe(permission: string): string {
  switch (permission) {
    case 'media':
      return 'your camera or microphone';
    case 'geolocation':
      return 'your location';
    case 'notifications':
      return 'notifications';
    case 'clipboard-read':
      return 'reading the clipboard';
    case 'clipboard-sanitized-write':
      return 'writing to the clipboard';
    case 'midi':
    case 'midiSysex':
      return 'MIDI devices';
    case 'pointerLock':
      return 'locking the pointer';
    case 'openExternal':
      return 'opening an external application';
    default:
      return permission;
  }
}

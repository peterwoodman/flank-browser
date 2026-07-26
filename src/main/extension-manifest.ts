import fs from 'fs';
import path from 'path';

export interface ExtensionManifestInfo {
  name: string;
  /** Absolute path to the icon file closest to 48px, if any. */
  iconPath: string | null;
  /** Manifest-relative options page, if any. */
  optionsPage: string | null;
  /** Manifest-relative toolbar popup ("action" MV3, "browser_action" MV2), if any. */
  popupPage: string | null;
}

/** Reads name, icon, options page, and action popup from an unpacked extension folder. */
export function parseExtensionManifest(folder: string): ExtensionManifestInfo {
  const fallback: ExtensionManifestInfo = {
    name: path.basename(folder),
    iconPath: null,
    optionsPage: null,
    popupPage: null
  };
  let root: Record<string, unknown>;
  try {
    root = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
  } catch {
    return fallback;
  }

  let name = typeof root.name === 'string' ? root.name : '';
  if (name.startsWith('__MSG_')) {
    name = resolveLocalizedName(folder, root, name) ?? path.basename(folder);
  }
  if (!name) name = fallback.name;

  let iconPath: string | null = null;
  const icons = root.icons;
  if (icons && typeof icons === 'object') {
    const sizes = Object.entries(icons as Record<string, unknown>)
      .filter(([k, v]) => /^\d+$/.test(k) && typeof v === 'string')
      .sort((a, b) => Math.abs(Number(a[0]) - 48) - Math.abs(Number(b[0]) - 48));
    if (sizes.length > 0) {
      const candidate = path.join(folder, (sizes[0][1] as string).replace(/^\//, ''));
      if (fs.existsSync(candidate)) iconPath = candidate;
    }
  }

  let optionsPage: string | null = null;
  if (typeof root.options_page === 'string') {
    optionsPage = root.options_page;
  } else if (
    root.options_ui &&
    typeof (root.options_ui as Record<string, unknown>).page === 'string'
  ) {
    optionsPage = (root.options_ui as Record<string, string>).page;
  }

  let popupPage: string | null = null;
  for (const actionKey of ['action', 'browser_action']) {
    const action = root[actionKey];
    if (action && typeof (action as Record<string, unknown>).default_popup === 'string') {
      popupPage = (action as Record<string, string>).default_popup;
      break;
    }
  }

  return { name, iconPath, optionsPage, popupPage };
}

function resolveLocalizedName(
  folder: string,
  root: Record<string, unknown>,
  msgName: string
): string | null {
  const key = msgName.replace(/^_+|_+$/g, '').replace('MSG_', '');
  const locale = typeof root.default_locale === 'string' ? root.default_locale : 'en';
  const messagesPath = path.join(folder, '_locales', locale, 'messages.json');
  try {
    const messages = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
    const entry = messages[key];
    if (entry && typeof entry.message === 'string') return entry.message;
  } catch {
    /* fall through */
  }
  return null;
}

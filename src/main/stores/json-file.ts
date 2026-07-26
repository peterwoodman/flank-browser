import fs from 'fs';
import path from 'path';
import { logError } from '../log';

/**
 * Loads and saves JSON config files. Saves are atomic (temp file + rename);
 * a file that fails to parse is preserved as *.bad and defaults are returned.
 * Loaded objects are overlaid on the defaults so missing fields get default
 * values (mirrors C# property initializers).
 */
export function loadJson<T extends object>(file: string, defaults: () => T): T {
  if (!fs.existsSync(file)) return defaults();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed === null || typeof parsed !== 'object') return defaults();
    return { ...defaults(), ...(parsed as Partial<T>) };
  } catch (err) {
    logError(`JsonFile.load ${path.basename(file)}`, err);
    try {
      fs.copyFileSync(file, file + '.bad');
    } catch {
      /* best effort */
    }
    return defaults();
  }
}

export function saveJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file); // overwrites atomically (MOVEFILE_REPLACE_EXISTING on Windows)
}

import fs from 'fs';
import { Space, SpacesFile, defaultSpacesFile } from '@shared/types';
import { colorScheme, DEFAULT_COLOR_SCHEME } from '@shared/color-schemes';
import { spacesFile, sessionFilePath } from '../paths';
import { loadJson, saveJson } from './json-file';
import { newId } from '../ids';
import { logError } from '../log';

/** Owns the list of Space models from spaces.json; saves immediately on change. */
class SpacesStore {
  file: SpacesFile = defaultSpacesFile();

  load(): void {
    this.file = loadJson(spacesFile, defaultSpacesFile);
    this.file.spaces.sort((a, b) => a.order - b.order);
    // JsonFile only fills defaults at the top level, so spaces written before
    // color schemes existed (or hand-edited to a name that isn't one) need
    // normalizing here — everything downstream indexes the palette directly.
    for (const space of this.file.spaces) {
      space.colorScheme = colorScheme(space.colorScheme).id;
    }
  }

  save(): void {
    this.file.spaces.forEach((s, i) => (s.order = i));
    saveJson(spacesFile, this.file);
  }

  get all(): Space[] {
    return this.file.spaces;
  }

  byId(id: string): Space | undefined {
    return this.file.spaces.find((s) => s.id === id);
  }

  /** Case-insensitive lookup by name or id, for `--space <name or id>`. */
  byNameOrId(nameOrId: string): Space | undefined {
    const needle = nameOrId.trim().toLowerCase();
    return (
      this.file.spaces.find((s) => s.id.toLowerCase() === needle) ??
      this.file.spaces.find((s) => s.name.trim().toLowerCase() === needle)
    );
  }

  create(name: string): Space {
    const space: Space = {
      id: newId(),
      name,
      order: this.file.spaces.length,
      splitRatio: 0.5,
      colorScheme: DEFAULT_COLOR_SCHEME,
      links: []
    };
    this.file.spaces.push(space);
    this.save();
    return space;
  }

  /** The fields the Manager's space settings dialog edits; absent = unchanged. */
  update(id: string, patch: { name?: string; colorScheme?: string }): void {
    const space = this.byId(id);
    if (!space) return;
    if (patch.name) space.name = patch.name;
    if (patch.colorScheme) space.colorScheme = colorScheme(patch.colorScheme).id;
    this.save();
  }

  /** Removes the space, its session file, and its entry everywhere. Never touches shared browser data. */
  remove(id: string): void {
    this.file.spaces = this.file.spaces.filter((s) => s.id !== id);
    this.save();
    try {
      fs.rmSync(sessionFilePath(id), { force: true });
    } catch (err) {
      logError('SpacesStore.remove session file', err);
    }
  }

  move(id: string, delta: -1 | 1): void {
    const idx = this.file.spaces.findIndex((s) => s.id === id);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= this.file.spaces.length) return;
    const [space] = this.file.spaces.splice(idx, 1);
    this.file.spaces.splice(target, 0, space);
    this.save();
  }
}

export const spacesStore = new SpacesStore();

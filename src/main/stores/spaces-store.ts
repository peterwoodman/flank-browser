import fs from 'fs';
import { Profile, Space, SpacesFile, defaultSpacesFile } from '@shared/types';
import { colorScheme, DEFAULT_COLOR_SCHEME } from '@shared/color-schemes';
import { spacesFile, sessionFilePath } from '../paths';
import { FIRST_PARTITION, partitionFor } from '../browser-session';
import { loadJson, saveJson } from './json-file';
import { newId } from '../ids';
import { logError } from '../log';

/** Owns the profiles and Space models from spaces.json; saves immediately on change. */
class SpacesStore {
  file: SpacesFile = defaultSpacesFile();

  load(): void {
    this.file = loadJson(spacesFile, defaultSpacesFile);
    this.normalize();
  }

  /**
   * JsonFile only fills defaults at the top level, so anything written by an
   * older version — or hand-edited into a state the rest of the app doesn't
   * index cleanly — is settled here. Nothing is written back; the next save
   * persists it.
   */
  private normalize(): void {
    this.file.profiles.sort((a, b) => a.order - b.order);

    const partitions = new Set<string>();
    for (const profile of this.file.profiles) {
      // A missing or repeated partition would quietly hand two profiles one
      // browsing identity, which is the one thing a profile has to keep.
      if (!profile.partition?.startsWith('persist:') || partitions.has(profile.partition)) {
        profile.partition = partitionFor(profile.id);
      }
      partitions.add(profile.partition);
    }
    // A file from before profiles existed: its spaces become one profile that
    // keeps the original partition, so the logins in it survive the upgrade.
    if (this.file.profiles.length === 0) {
      this.file.profiles.push({
        id: newId(),
        name: 'Default',
        order: 0,
        partition: FIRST_PARTITION
      });
    }

    this.file.spaces.sort((a, b) => a.order - b.order);
    for (const space of this.file.spaces) {
      space.colorScheme = colorScheme(space.colorScheme).id;
      if (!this.profileById(space.profileId)) space.profileId = this.file.profiles[0].id;
    }
  }

  save(): void {
    this.file.profiles.forEach((p, i) => (p.order = i));
    // Spaces stay grouped by profile in file order — the order the Manager
    // lists them in — keeping their existing order within a profile.
    const profileOrder = new Map(this.file.profiles.map((p, i) => [p.id, i]));
    this.file.spaces.sort(
      (a, b) => (profileOrder.get(a.profileId) ?? 0) - (profileOrder.get(b.profileId) ?? 0)
    );
    this.file.spaces.forEach((s, i) => (s.order = i));
    saveJson(spacesFile, this.file);
  }

  get all(): Space[] {
    return this.file.spaces;
  }

  byId(id: string): Space | undefined {
    return this.file.spaces.find((s) => s.id === id);
  }

  /**
   * Case-insensitive lookup by name or id, for `--space <name or id>`. A name
   * duplicated across profiles resolves to the first profile holding it.
   */
  byNameOrId(nameOrId: string): Space | undefined {
    const needle = nameOrId.trim().toLowerCase();
    return (
      this.file.spaces.find((s) => s.id.toLowerCase() === needle) ??
      this.file.spaces.find((s) => s.name.trim().toLowerCase() === needle)
    );
  }

  create(name: string, profileId: string): Space {
    const space: Space = {
      id: newId(),
      name,
      profileId: (this.profileById(profileId) ?? this.file.profiles[0]).id,
      order: this.file.spaces.length,
      splitRatio: 0.5,
      colorScheme: DEFAULT_COLOR_SCHEME,
      links: []
    };
    this.file.spaces.push(space);
    this.save();
    return space;
  }

  /**
   * Copies a space into another profile: the same name, color, and pinned
   * links, but its own identity — a fresh id, no saved session, and no window
   * placement, since the original's window is not this one's.
   */
  duplicate(spaceId: string, profileId: string): Space | undefined {
    const source = this.byId(spaceId);
    const profile = this.profileById(profileId);
    if (!source || !profile) return undefined;

    const copy: Space = {
      id: newId(),
      name: source.name,
      profileId: profile.id,
      order: this.file.spaces.length,
      splitRatio: source.splitRatio,
      colorScheme: source.colorScheme,
      links: source.links.map((link) => ({ ...link, id: newId() }))
    };
    this.file.spaces.push(copy);
    this.save();
    return copy;
  }

  /** The fields the Manager's space settings dialog edits; absent = unchanged. */
  update(id: string, patch: { name?: string; colorScheme?: string }): void {
    const space = this.byId(id);
    if (!space) return;
    if (patch.name) space.name = patch.name;
    if (patch.colorScheme) space.colorScheme = colorScheme(patch.colorScheme).id;
    this.save();
  }

  /** Removes the space, its session file, and its entry everywhere. Never touches browsing data. */
  remove(id: string): void {
    this.file.spaces = this.file.spaces.filter((s) => s.id !== id);
    this.save();
    try {
      fs.rmSync(sessionFilePath(id), { force: true });
    } catch (err) {
      logError('SpacesStore.remove session file', err);
    }
  }

  /** Reorders a space among the others in its own profile. */
  move(id: string, delta: -1 | 1): void {
    const index = this.file.spaces.findIndex((s) => s.id === id);
    if (index < 0) return;
    const space = this.file.spaces[index];
    const siblings = this.spacesIn(space.profileId);
    const target = siblings[siblings.indexOf(space) + delta];
    if (!target) return;

    const targetIndex = this.file.spaces.indexOf(target);
    this.file.spaces.splice(index, 1);
    this.file.spaces.splice(targetIndex, 0, space);
    this.save();
  }

  // --- Profiles ---

  get profiles(): Profile[] {
    return this.file.profiles;
  }

  profileById(id: string): Profile | undefined {
    return this.file.profiles.find((p) => p.id === id);
  }

  /** The profile a space browses as; the first one covers a dangling id. */
  profileOf(space: Space): Profile {
    return this.profileById(space.profileId) ?? this.file.profiles[0];
  }

  spacesIn(profileId: string): Space[] {
    return this.file.spaces.filter((s) => s.profileId === profileId);
  }

  createProfile(name: string): Profile {
    const id = newId();
    const profile: Profile = {
      id,
      name,
      order: this.file.profiles.length,
      partition: partitionFor(id)
    };
    this.file.profiles.push(profile);
    this.save();
    return profile;
  }

  renameProfile(id: string, name: string): void {
    const profile = this.profileById(id);
    if (!profile || !name) return;
    profile.name = name;
    this.save();
  }

  /**
   * Removes an empty profile — never the last one, since every space needs a
   * profile to browse as. Returns it so the caller can discard its browsing
   * data.
   */
  removeProfile(id: string): Profile | undefined {
    const profile = this.profileById(id);
    if (!profile || this.file.profiles.length < 2 || this.spacesIn(id).length > 0) return undefined;
    this.file.profiles = this.file.profiles.filter((p) => p.id !== id);
    this.save();
    return profile;
  }
}

export const spacesStore = new SpacesStore();

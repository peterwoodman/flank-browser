import { randomUUID } from 'crypto';

/** GUID string without dashes (docs/data-model.md). */
export function newId(): string {
  return randomUUID().replace(/-/g, '');
}

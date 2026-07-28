import { Session } from 'electron';
import { Space, SpaceLink, SessionSection, TrailEntry, TRAIL_CAP } from '@shared/types';
import { SplashDto } from '@shared/space-types';
import { ContentView } from './content-view';
import { settingsStore } from './stores/settings-store';
import { iconUrl } from './icons-protocol';

const ADHOC_KEY = 'adhoc'; // searches, right-section pages, restores

interface Tab {
  key: string;
  view: ContentView;
  hiddenAt: number;
}

/**
 * One space section: shows either the home view or a web view.
 *
 * The left section treats each home link as a tab: its view stays loaded in
 * the background after navigating away, so returning resumes without a page
 * reload. Backgrounded tabs are evicted after `backgroundTabMinutes`. The
 * right section always uses a single (ad-hoc) view (docs/behaviors.md).
 */
export class Section {
  private readonly tabs = new Map<string, Tab>();
  private activeTab: Tab | null = null;
  private lastActiveTab: Tab | null = null;
  private dormantTrail: TrailEntry[] | null = null; // restored trail waiting for a view to own it
  private evictionTimer: NodeJS.Timeout | null = null;

  readonly isLeft: boolean;
  private readonly space: Space;
  /** The space's profile partition; every view here browses as that profile. */
  private readonly session: Session;

  /** A tab's view was created/shown/hidden/destroyed; owner re-attaches views and pushes state. */
  onViewsChanged: () => void = () => {};
  onChanged: () => void = () => {};
  /** Wires the owner's callbacks on a freshly created view. */
  configureView: (view: ContentView) => void = () => {};

  constructor(space: Space, isLeft: boolean, ses: Session) {
    this.space = space;
    this.isLeft = isLeft;
    this.session = ses;
    if (isLeft) {
      this.evictionTimer = setInterval(() => this.evictExpiredTabs(), 60_000);
    }
  }

  get mode(): 'home' | 'web' {
    return this.activeTab ? 'web' : 'home';
  }

  get activeView(): ContentView | null {
    return this.activeTab?.view ?? null;
  }

  /** The home ✕ returns to the last page view; without one the right section's ✕ closes it. */
  get canReturnFromHome(): boolean {
    return this.lastActiveTab !== null;
  }

  allViews(): ContentView[] {
    return [...this.tabs.values()].map((t) => t.view);
  }

  private getOrCreateTab(key: string): { tab: Tab; created: boolean } {
    const existing = this.tabs.get(key);
    if (existing) return { tab: existing, created: false };

    const view = new ContentView(this.session);
    view.pinned = this.isLeft;
    view.linkId = key === ADHOC_KEY ? null : key;
    this.configureView(view);

    if (this.dormantTrail) {
      view.setTrail(this.dormantTrail);
      this.dormantTrail = null;
    }

    const tab: Tab = { key, view, hiddenAt: Date.now() };
    this.tabs.set(key, tab);
    return { tab, created: true };
  }

  private showTab(tab: Tab): void {
    if (this.activeTab !== tab) {
      if (this.activeTab) this.activeTab.hiddenAt = Date.now();
      this.activeTab = tab;
      this.lastActiveTab = tab;
    }
    this.onViewsChanged();
  }

  showHome(): void {
    if (this.activeTab) {
      this.activeTab.hiddenAt = Date.now();
      this.activeTab = null;
    }
    this.onViewsChanged();
  }

  /** The home ✕: back to the page this section was showing before home. */
  returnFromHome(): boolean {
    if (this.lastActiveTab) {
      this.showTab(this.lastActiveTab);
      return true;
    }
    return false;
  }

  openLink(link: SpaceLink): void {
    if (!this.isLeft) {
      this.navigateAdhoc(link.url);
      return;
    }

    const { tab, created } = this.getOrCreateTab(link.id);
    if (created) tab.view.showSplash(splashFor(link));
    this.showTab(tab);
    if (created) tab.view.navigate(link.url);
    // An existing tab resumes exactly where it was — no reload.
  }

  navigateAdhoc(url: string): void {
    const { tab } = this.getOrCreateTab(ADHOC_KEY);
    this.showTab(tab);
    tab.view.navigate(url);
  }

  /** True while this section holds the given view. */
  owns(view: ContentView): boolean {
    for (const tab of this.tabs.values()) if (tab.view === view) return true;
    return false;
  }

  /**
   * Gives up ownership of a live view so the other section can take it over.
   * The view stays loaded and attached, and the caller re-homes it straight
   * away, so this deliberately reports no change: detaching the page and
   * re-attaching it around the move would only make it flicker.
   */
  release(view: ContentView): void {
    for (const tab of [...this.tabs.values()]) {
      if (tab.view !== view) continue;
      this.tabs.delete(tab.key);
      if (this.activeTab === tab) this.activeTab = null;
      if (this.lastActiveTab === tab) this.lastActiveTab = null;
    }
  }

  /**
   * Shows a live view released by the other section. Nothing reloads — only
   * ownership moves — so the page keeps its document, scroll position, and
   * playing media, and it takes on this section's rules from here on.
   *
   * The moved page inherits the *tab* of the page it replaces, trail included,
   * rather than arriving as a stranger: replace a home link's page and the
   * moved page becomes that link's tab, so going home and activating the link
   * again resumes it like any other keep-alive tab
   * (docs/behaviors.md → Sections lifecycle). With nothing on show here it
   * becomes the ad-hoc page. Other background tabs are untouched.
   */
  takeOver(view: ContentView): void {
    const key = this.activeTab?.key ?? ADHOC_KEY;
    const replaced = this.tabs.get(key) ?? null;

    view.setTrail(mergeTrails(view.trail, replaced?.view.trail ?? this.dormantTrail ?? []));
    this.dormantTrail = null;

    if (replaced) {
      this.tabs.delete(key);
      if (this.lastActiveTab === replaced) this.lastActiveTab = null;
    }
    this.activeTab = null;

    view.pinned = this.isLeft;
    // Taking on the link means the link's tile follows this page too — the
    // host guard on captured icons is what keeps a foreign site out of it.
    view.linkId = key === ADHOC_KEY ? null : key;
    const tab: Tab = { key, view, hiddenAt: Date.now() };
    this.tabs.set(key, tab);
    this.showTab(tab);

    // Destroyed only now that the owner has taken it off the window, and
    // destroyed rather than parked: a blank view left under a link's key
    // would make that link resume an empty page instead of reloading.
    replaced?.view.destroy();
  }

  /**
   * Receives a *link* opened from the other section (there is no view to move
   * yet): navigates this section's current view in place, so its existing
   * trail is kept and the URL lands on top of it.
   */
  promote(url: string): void {
    if (!this.activeTab && this.lastActiveTab) this.showTab(this.lastActiveTab);

    if (this.activeTab) {
      this.activeTab.view.navigate(url);
      this.onViewsChanged();
    } else {
      this.navigateAdhoc(url); // nothing loaded here yet
    }
  }

  private evictExpiredTabs(): void {
    const timeoutMs = Math.max(1, settingsStore.current.backgroundTabMinutes) * 60_000;
    let changed = false;
    for (const tab of [...this.tabs.values()]) {
      if (tab === this.activeTab || Date.now() - tab.hiddenAt < timeoutMs) continue;

      this.tabs.delete(tab.key);
      if (this.lastActiveTab === tab) this.lastActiveTab = null; // ✕ has nothing to return to
      tab.view.destroy();
      changed = true;
    }
    if (changed) this.onViewsChanged();
  }

  captureSession(open: boolean): SessionSection {
    const view = (this.activeTab ?? this.lastActiveTab ?? this.tabs.get(ADHOC_KEY))?.view;
    return {
      mode: this.mode,
      url: view?.currentUrl() ?? '',
      open,
      trail: view ? [...view.trail] : (this.dormantTrail ?? [])
    };
  }

  /** Loads the saved trail and, when `navigate` is set, reopens the last page. */
  restoreSession(sessionSection: SessionSection, navigate: boolean): void {
    if (navigate && sessionSection.mode === 'web' && sessionSection.url) {
      const link = this.isLeft
        ? this.space.links.find((l) => l.url === sessionSection.url)
        : undefined;
      const { tab } = this.getOrCreateTab(link?.id ?? ADHOC_KEY);
      tab.view.setTrail(sessionSection.trail);
      if (link) tab.view.showSplash(splashFor(link));
      this.showTab(tab);
      tab.view.navigate(sessionSection.url, { suppressTrail: true });
    } else {
      // Keep the trail available without loading anything; the first view
      // created in this section inherits it.
      this.dormantTrail = sessionSection.trail;
    }
  }

  /** Returns to home and unloads web views (used when the section is closed). */
  reset(): void {
    this.lastActiveTab = null; // parked views are blank; nothing to return to
    this.showHome();
    for (const tab of this.tabs.values()) tab.view.park();
  }

  dispose(): void {
    if (this.evictionTimer) clearInterval(this.evictionTimer);
    for (const tab of this.tabs.values()) tab.view.destroy();
    this.tabs.clear();
    this.activeTab = null;
    this.lastActiveTab = null;
  }
}

/**
 * A moved page's trail above the trail of the page it replaces. The seam
 * collapses a duplicate the way consecutive duplicates collapse anywhere in a
 * trail, and the usual cap applies.
 */
function mergeTrails(moved: TrailEntry[], replaced: TrailEntry[]): TrailEntry[] {
  const merged = [...moved];
  for (const entry of replaced) {
    if (merged.length > 0 && merged[merged.length - 1].url === entry.url) continue;
    merged.push(entry);
  }
  return merged.slice(0, TRAIL_CAP);
}

/** PWA-style launch splash: the link's icon and name on the app's manifest color. */
function splashFor(link: SpaceLink): SplashDto {
  return {
    title: link.title,
    icon: link.icon ? iconUrl(link.icon) : '',
    background: link.background ?? ''
  };
}

/**
 * Linux display server.
 *
 * Flank takes the session as it finds it: native Wayland under a Wayland
 * session, X11 under an X11 one. The Wayland protocol deliberately forbids a
 * client from placing its own windows — `setPosition` is a no-op — so under
 * Wayland the compositor decides where windows and extension popups land, and
 * Flank restores only their size.
 *
 * Asking for XWayland instead (`--ozone-platform=x11`) would restore both
 * behaviors, but the platform has to be settled before Electron starts its
 * display backend: appending the switch from this process leaves the browser
 * process on Wayland while the GPU and renderer processes come up on X11, and
 * a window in that split state never receives a frame — it exists, reports
 * itself visible, and shows nothing on screen.
 *
 * `ELECTRON_OZONE_PLATFORM_HINT=x11` is Electron's own pre-startup way to ask
 * for XWayland; whether a build and session honor it varies, and Flank trusts
 * it for the positioning decision when set.
 */

/** Whether windows can be placed by the app rather than the compositor. */
export function canPositionWindows(): boolean {
  if (process.platform !== 'linux') return true;
  if (ozoneHint() === 'x11') return true;
  return !isWaylandSession();
}

/**
 * Whether screen capture goes through xdg-desktop-portal. Wayland gives no
 * client the pixels of another, so capture is a request to the compositor,
 * which runs its own picker; X11 lets Chromium enumerate and capture directly.
 */
export function screenCaptureUsesPortal(): boolean {
  if (process.platform !== 'linux') return false;
  if (ozoneHint() === 'x11') return false;
  return isWaylandSession();
}

/** One line for debug.log, explaining after the fact why windows placed as they did. */
export function describeLinuxSession(): string {
  const hint = ozoneHint();
  return [
    `XDG_SESSION_TYPE=${process.env.XDG_SESSION_TYPE ?? 'unset'}`,
    `ozone=${hint ? `hint:${hint}` : 'session default'}`,
    `positioning=${canPositionWindows() ? 'available' : 'unavailable (native Wayland)'}`
  ].join(' ');
}

function ozoneHint(): string | undefined {
  return process.env.ELECTRON_OZONE_PLATFORM_HINT?.trim().toLowerCase() || undefined;
}

function isWaylandSession(): boolean {
  return (
    process.env.XDG_SESSION_TYPE?.toLowerCase() === 'wayland' || !!process.env.WAYLAND_DISPLAY
  );
}

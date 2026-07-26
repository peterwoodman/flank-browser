export function invoke<T = void>(channel: string, ...args: unknown[]): Promise<T> {
  return window.flank.invoke(channel, ...args) as Promise<T>;
}

export function send(channel: string, ...args: unknown[]): void {
  window.flank.send(channel, ...args);
}

export function on(channel: string, listener: (...args: unknown[]) => void): () => void {
  return window.flank.on(channel, listener);
}

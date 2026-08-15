// Deterministic in-memory localStorage for unit tests. jsdom's built-in
// Storage is unreliable under vitest (the --localstorage-file warning), so we
// install a clean implementation before any test module imports.
class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  clear(): void {
    this.m.clear();
  }
  getItem(key: string): string | null {
    return this.m.has(key) ? (this.m.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.m.set(String(key), String(value));
  }
  removeItem(key: string): void {
    this.m.delete(key);
  }
  key(index: number): string | null {
    return [...this.m.keys()][index] ?? null;
  }
}

Object.defineProperty(globalThis, "localStorage", {
  value: new MemStorage(),
  configurable: true,
  writable: true,
});

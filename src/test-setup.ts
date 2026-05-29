import "@testing-library/jest-dom/vitest";

// Node 25 ships an experimental no-op localStorage that shadows happy-dom's.
// Install a deterministic in-memory Storage for tests.
class MemoryStorage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  key(i: number) {
    return [...this.store.keys()][i] ?? null;
  }
}

Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
});

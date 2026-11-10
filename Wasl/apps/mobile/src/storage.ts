import AsyncStorage from "@react-native-async-storage/async-storage";
import { DemoStore, uid } from "../../../packages/shared/src/demo";

// Chunk snapshots below Android's per-row cursor limit. The manifest pointer is
// written last, so interrupted writes never replace a complete previous snapshot.
const CHUNK = 96_000;
interface Manifest { waslChunks: 1; generation: string; count: number }
function manifest(raw: string | null): Manifest | undefined {
  if (!raw) return;
  try { const v = JSON.parse(raw) as Manifest; if (v.waslChunks === 1 && typeof v.generation === "string" && Number.isInteger(v.count) && v.count > 0 && v.count < 1000) return v; } catch { /* Normal text preferences are not manifests. */ }
}
const keyFor = (key: string, m: Manifest, i: number) => `${key}:${m.generation}:${i}`;
export const nativeStore = new DemoStore({
  async get(key) {
    const raw = await AsyncStorage.getItem(key); const m = manifest(raw);
    if (!m) return raw;
    const chunks = await AsyncStorage.multiGet(Array.from({ length: m.count }, (_, i) => keyFor(key, m, i)));
    if (chunks.some(([, value]) => value === null)) throw new Error("Incomplete snapshot");
    return chunks.map(([, value]) => value).join("");
  },
  async set(key, value) {
    const previous = manifest(await AsyncStorage.getItem(key));
    const m: Manifest = { waslChunks: 1, generation: uid(), count: Math.ceil(value.length / CHUNK) || 1 };
    await AsyncStorage.multiSet(Array.from({ length: m.count }, (_, i) => [keyFor(key, m, i), value.slice(i * CHUNK, (i + 1) * CHUNK)] as [string, string]));
    await AsyncStorage.setItem(key, JSON.stringify(m));
    if (previous) { try { await AsyncStorage.multiRemove(Array.from({ length: previous.count }, (_, i) => keyFor(key, previous, i))); } catch { /* Stale chunks can safely remain after successful replacement. */ } }
  },
});
export { AsyncStorage };

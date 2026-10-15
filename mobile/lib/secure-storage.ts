export type SecretStore = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};
type Manifest = { version: string; chunks: number };
function splitSecureValue(value: string): string[] {
  const result: string[] = [];
  let chunk = "",
    bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    const width =
      point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + width > chunkSize) {
      result.push(chunk);
      chunk = "";
      bytes = 0;
    }
    chunk += character;
    bytes += width;
  }
  if (chunk) result.push(chunk);
  return result;
}
const chunkSize = 1500;
const maxChunks = 64;

/** Chunked, serialised Keychain/Keystore storage. A manifest commits a whole session. */
export function createSecureStorage(store: SecretStore, version: () => string) {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
    return next;
  };
  const name = (key: string) => key.replace(/[^a-zA-Z0-9._-]/g, "_");
  const manifest = async (key: string): Promise<Manifest | null> => {
    const raw = await store.getItemAsync(`${key}.manifest`);
    try {
      const parsed = JSON.parse(raw || "null");
      return parsed &&
        /^[a-zA-Z0-9-]{1,80}$/.test(parsed.version) &&
        Number.isInteger(parsed.chunks) &&
        parsed.chunks > 0 &&
        parsed.chunks <= maxChunks
        ? parsed
        : null;
    } catch {
      return null;
    }
  };
  const clean = async (key: string, item: Manifest | null) => {
    if (item)
      for (let i = 0; i < item.chunks; i++)
        await store
          .deleteItemAsync(`${key}.${item.version}.${i}`)
          .catch(() => undefined);
  };
  return {
    getItem(key: string) {
      return serial(async () => {
        const safe = name(key),
          current = await manifest(safe);
        if (!current) return null;
        const chunks: string[] = [];
        for (let i = 0; i < current.chunks; i++) {
          const value = await store.getItemAsync(
            `${safe}.${current.version}.${i}`,
          );
          if (value === null) return null;
          chunks.push(value);
        }
        return chunks.join("");
      });
    },
    setItem(key: string, value: string) {
      return serial(async () => {
        const safe = name(key),
          previous = await manifest(safe);
        const values = splitSecureValue(value);
        const next = { version: version(), chunks: values.length };
        if (
          !/^[a-zA-Z0-9-]{1,80}$/.test(next.version) ||
          next.chunks < 1 ||
          next.chunks > maxChunks
        )
          throw new Error("Session could not be stored securely");
        try {
          for (let i = 0; i < next.chunks; i++)
            await store.setItemAsync(`${safe}.${next.version}.${i}`, values[i]);
          await store.setItemAsync(`${safe}.manifest`, JSON.stringify(next));
        } catch (error) {
          await clean(safe, next);
          throw error;
        }
        await clean(safe, previous);
      });
    },
    removeItem(key: string) {
      return serial(async () => {
        const safe = name(key),
          previous = await manifest(safe);
        await store.deleteItemAsync(`${safe}.manifest`);
        await clean(safe, previous);
      });
    },
  };
}

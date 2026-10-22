// Merge independent edits; never guess how to interleave two model conversations.
const groups = [['messages', 'context', 'publicSources'], ['draft', 'source', 'materials'], ['title']];
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const defaults = {draft:'', source:null, materials:[], messages:[], publicSources:[]};
const values = (chat, keys) => keys.map(k => chat?.[k] ?? defaults[k]);
export function mergeChat(current, incoming, base) {
  if (!current) return null;
  if ((current.revision || 0) === (incoming.revision || 0)) return {...incoming};
  if (!base || base.id !== incoming.id || (base.revision || 0) !== (incoming.revision || 0)) return null;
  const merged = {...current};
  for (const keys of groups) {
    const before = values(base, keys), local = values(incoming, keys), remote = values(current, keys);
    if (same(local, before)) continue;
    if (!same(remote, before) && !same(remote, local)) return null;
    for (const key of keys) {
      if (Object.hasOwn(incoming, key)) merged[key] = incoming[key];
      else delete merged[key];
    }
  }
  return merged;
}

// One queue per window. Snapshot when the queued write starts, after earlier receipts.
// Preserve edits made while a write was in flight, and retain live answer references.
export function chatSaver(write, onSaved = () => {}) {
  const bases = new WeakMap();
  let queue = Promise.resolve(), pending = 0;
  return {
    adopt(chat) { bases.set(chat, structuredClone(chat)); return chat; },
    clean(chat) { return !pending && same(chat, bases.get(chat)); },
    save(chat) {
      pending++;
      const job = queue.then(async () => {
        const snapshot = structuredClone(chat), base = bases.get(chat);
        const result = await write({op: 'save', chat: snapshot, base});
        const saved = result.store.chats.find(c => c.id === (result.savedChatId || snapshot.id));
        if (!saved) throw new Error('会话保存未返回确认，请重试。');
        for (const key of new Set([...Object.keys(snapshot), ...Object.keys(saved)])) {
          if (['id', 'revision', 'updated', 'conflictOf'].includes(key) || same(chat[key], snapshot[key])) {
            if (same(chat[key], saved[key])) continue;
            if (Object.hasOwn(saved, key)) chat[key] = structuredClone(saved[key]);
            else delete chat[key];
          }
        }
        bases.set(chat, structuredClone(saved));
        onSaved(result, chat);
        return result;
      }).finally(() => { pending--; });
      queue = job.catch(() => {});
      return job;
    }
  };
}

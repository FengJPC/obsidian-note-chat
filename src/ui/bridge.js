const channel = window.NOTE_CHAT_CHANNEL;
const pending = new Map(), streams = new Map(), changed = new Set();
export function hostCall(message, timeoutMs = 30000) {
  const rpcId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(rpcId); reject(new Error('插件后台没有回应，请关闭并重新打开侧栏。')); }, timeoutMs);
    pending.set(rpcId, {resolve, timer}); parent.postMessage({channel, rpcId, ...message}, '*');
  });
}
window.addEventListener('message', event => {
  const msg = event.data;
  if (event.source !== parent || msg?.channel !== channel) return;
  if (msg.type === 'rpcResult') { const entry = pending.get(msg.rpcId); if (entry) { clearTimeout(entry.timer); pending.delete(msg.rpcId); entry.resolve(msg.result); } }
  if (msg.type === 'storageChanged') for (const listener of changed) listener(msg.changes, msg.area);
  if (msg.type === 'stageMaterial') window.dispatchEvent(new CustomEvent('note-chat-material', {detail: msg.material}));
  const stream = streams.get(msg.requestId);
  if (!stream) return;
  if (msg.type === 'streamChunk') stream.enqueue(Uint8Array.from(msg.chunk));
  if (msg.type === 'streamEnd') { stream.close(); streams.delete(msg.requestId); }
  if (msg.type === 'streamError') { stream.error(new Error(msg.error)); streams.delete(msg.requestId); }
});
async function storageCall(type, args) { const result = await hostCall({type, ...args}); if (!result.ok) throw new Error(result.error); return result.values; }
globalThis.chrome = {
  runtime: {sendMessage: message => hostCall(message, message.type === 'models' ? 60000 : 30000)},
  storage: {local: {get: keys => storageCall('get', {keys}), set: values => storageCall('set', {values}), remove: keys => storageCall('remove', {keys})}, onChanged: {addListener: listener => changed.add(listener)}},
};
const originalFetch = window.fetch.bind(window);
window.fetch = async (url, options = {}) => {
  if (String(url) !== 'https://api.openai.com/v1/responses') return originalFetch(url, options);
  const requestId = crypto.randomUUID(), signal = options.signal;
  if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  let control, closed = false;
  const stop = () => {
    hostCall({type: 'cancelResponse', requestId}).catch(() => {});
    if (!closed) { closed = true; control.error(new DOMException('Stopped', 'AbortError')); streams.delete(requestId); }
  };
  const body = new ReadableStream({start(controller) { control = controller; streams.set(requestId, {
    enqueue(value) { if (!closed) controller.enqueue(value); },
    close() { if (!closed) { closed = true; controller.close(); } signal?.removeEventListener('abort', stop); },
    error(error) { if (!closed) { closed = true; controller.error(error); } signal?.removeEventListener('abort', stop); },
  }); }, cancel() { closed = true; streams.delete(requestId); signal?.removeEventListener('abort', stop); return hostCall({type: 'cancelResponse', requestId}).catch(() => {}); }});
  signal?.addEventListener('abort', stop, {once: true});
  try {
    const result = await hostCall({type: 'response', requestId, payload: JSON.parse(options.body)}, 190000);
    if (!result.ok) throw new Error(result.error);
    if (result.status < 200 || result.status >= 300) {
      streams.delete(requestId); signal?.removeEventListener('abort',stop);
      if (!closed) {closed=true;control.close();}
      return {ok:false,status:result.status,json:async()=>({error:result.apiError})};
    }
    return {ok: true, status: result.status, body};
  } catch (e) { streams.delete(requestId); signal?.removeEventListener('abort', stop); throw e; }
};
document.addEventListener('click', event => {
  const anchor = event.target.closest('a[href]'); if (!anchor) return;
  event.preventDefault(); hostCall({type: 'openExternal', url: anchor.href}).catch(() => {});
});
window.addEventListener('pagehide', () => { for (const requestId of streams.keys()) hostCall({type: 'cancelResponse', requestId}).catch(() => {}); });

// Conservative UTF-8 text budget, independent of provider-specific tokenizers.
// Images are already bounded by the material pipeline; do not count base64 as text.
export const CONTEXT_BYTES = 240000;
export const CONTEXT_WIRE_BYTES = 12000000;
const encoder = new TextEncoder();
function cost(value, key = '') {
  if (key === 'image_url' && typeof value === 'string' && value.startsWith('data:image/')) return 4096;
  if (typeof value === 'string') return encoder.encode(value).length;
  if (Array.isArray(value)) return value.reduce((n, x) => n + cost(x), 0);
  if (value && typeof value === 'object') return Object.entries(value).reduce((n, [k, v]) => n + cost(v, k), 0);
  return 0;
}
export function budgetContext(input, limit = CONTEXT_BYTES, wireLimit = CONTEXT_WIRE_BYTES) {
  const starts = [];
  for (let i = 0; i < input.length; i++) if (input[i].role === 'user') starts.push(i);
  const weights=input.map(item=>cost(item)), wireWeights=input.map(item=>encoder.encode(JSON.stringify(item)).length+1);
  let offset = 0, bytes = weights.reduce((a,b)=>a+b,0), wireBytes=2+wireWeights.reduce((a,b)=>a+b,0), removed = 0;
  // Trim complete old user turns only: reasoning, calls and outputs stay together.
  for (const next of starts.slice(1)) {
    if (bytes <= limit && wireBytes <= wireLimit) break;
    for(let i=offset;i<next;i++){bytes-=weights[i];wireBytes-=wireWeights[i];} offset = next; removed++;
  }
  if (bytes > limit || wireBytes > wireLimit) throw new Error('本轮资料超过上下文预算，请减少附件或读取范围后重试；原始记录仍保留。');
  return {input: input.slice(offset), removed, bytes, wireBytes};
}

export function canUseToken(record, now = Date.now()) {
  if (record.expiresAt > now + 60000) return true;
  const raw = record.earliestRefreshAt, numeric = Number(raw);
  const earliest = Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : Date.parse(raw);
  if (earliest > now) {
    if (record.expiresAt > now) return true;
    throw new Error('授权已过期，但服务端暂未允许刷新，请稍后再试或重新登录。');
  }
  return false;
}

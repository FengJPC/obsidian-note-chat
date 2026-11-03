import test from 'node:test';
import assert from 'node:assert/strict';
import {readUIAsset} from '../src/ui-assets.js';

test('sidebar assets recover from a temporary cloud-sync file lock', async () => {
  let attempts = 0;
  const text = await readUIAsset('ui.js', async () => {
    if (++attempts === 1) throw Object.assign(new Error('locked'), {code:'EBUSY'});
    return 'fixture UI';
  });
  assert.equal(text, 'fixture UI');assert.equal(attempts, 2);
});

test('missing sidebar files fail immediately and permanent locks have a bounded retry count', async () => {
  let attempts = 0;
  await assert.rejects(readUIAsset('missing', async () => {attempts++;throw Object.assign(new Error('missing'),{code:'ENOENT'});}), /missing/);
  assert.equal(attempts,1);attempts=0;
  await assert.rejects(readUIAsset('locked', async () => {attempts++;throw Object.assign(new Error('locked'),{code:'EBUSY'});}), /locked/);
  assert.equal(attempts,5);
});

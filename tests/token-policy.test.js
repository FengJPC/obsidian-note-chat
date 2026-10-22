import test from 'node:test';import assert from 'node:assert/strict';
import {canUseToken} from '../src/shared/token-policy.js';
test('refresh gate accepts seconds, milliseconds, numeric strings and ISO dates',()=>{
 const now=1800000000000;
 for(const earliestRefreshAt of [(now+30000)/1000,now+30000,String((now+30000)/1000),new Date(now+30000).toISOString()]){
  assert.equal(canUseToken({expiresAt:now+10000,earliestRefreshAt},now),true);
  assert.throws(()=>canUseToken({expiresAt:now-1,earliestRefreshAt},now),/暂未允许刷新/);
 }
 assert.equal(canUseToken({expiresAt:now+30000,earliestRefreshAt:0},now),false);
 assert.equal(canUseToken({expiresAt:now+120000},now),true);
});

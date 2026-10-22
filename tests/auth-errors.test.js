import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizationError} from '../src/shared/auth-errors.js';
const error = (body,grant='refresh_token',status=400) => authorizationError(new Response(JSON.stringify(body),{status}),grant);
test('terminal refresh errors distinguish OAuth string and nested API codes',async()=>{
  for(const code of ['invalid_grant','invalid_refresh_token','token_expired','refresh_token_expired','refresh_token_invalidated','refresh_token_reused']){
    for(const body of [{error:code},{error:{code}}]){
      const e=await error(body);assert.equal(e.unusable,true);assert.equal(e.diagnostic.code,code);assert.match(e.message,/刷新授权失败/);
    }
  }
  const login=await error({error:'invalid_grant'},'authorization_code');
  assert.equal(login.unusable,false);assert.match(login.message,/登录换码失败/);
});
test('unknown 400, invalid client and infrastructure errors never discard credentials',async()=>{
  for(const [code,status] of [['unknown',400],['invalid_client',400],['invalid_grant',503],['server_error',500],['invalid_grant',429]]){
    assert.equal((await error({error:code},'refresh_token',status)).unusable,false);
  }
});
test('diagnostics cannot echo credentials, descriptions, unknown codes or HTML',async()=>{
  for(const body of [{error:'SECRET_REFRESH_TOKEN',error_description:'SECRET_ACCESS_TOKEN'},{error:{code:'invalid_grant',message:'SECRET_ACCESS_TOKEN'}},{detail:'SECRET_ACCESS_TOKEN'}]){
    const e=await error(body);assert.ok(!JSON.stringify(e).includes('SECRET'));assert.ok(!e.message.includes('SECRET'));
    assert.deepEqual(Object.keys(e.diagnostic),['at','phase','httpStatus','code']);
  }
  const e=await authorizationError(new Response('<html>SECRET</html>',{status:400}),'refresh_token');
  assert.equal(e.diagnostic.code,'unrecognized_error');assert.equal(e.unusable,false);
});
test('oversized error responses are bounded and ignored',async()=>{
  const e=await error({error:'invalid_grant',error_description:'x'.repeat(17000)});
  assert.equal(e.diagnostic.code,'unrecognized_error');assert.equal(e.unusable,false);
});

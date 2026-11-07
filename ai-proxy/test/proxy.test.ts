import {beforeAll,describe,expect,it,vi} from 'vitest';
import {webcrypto,timingSafeEqual,randomUUID} from 'node:crypto';
import worker,{MODEL} from '../src/index';
const SECRET='unit-test-only-'+'a'.repeat(48);
beforeAll(()=>{vi.stubGlobal('crypto',{subtle:{digest:webcrypto.subtle.digest.bind(webcrypto.subtle),timingSafeEqual:(a:ArrayBuffer,b:ArrayBuffer)=>timingSafeEqual(Buffer.from(a),Buffer.from(b))},randomUUID});});
function request(body:unknown,token=SECRET){return new Request('https://proxy.test/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});}
const body=()=>({model:MODEL,messages:[{role:'user',content:'Extract proposed facts from page 1: septic plan.'}],max_completion_tokens:1200});
function env(response:unknown={response:{facts:[]},usage:{prompt_tokens:20,completion_tokens:5}}){return {AI_PROXY_SECRET:SECRET,AI:{run:vi.fn(async()=>response)}} as unknown as Env;}

describe('bounded authenticated extraction proxy',()=>{
 it('rejects unauthenticated requests before inference',async()=>{const e=env();expect((await worker.fetch(request(body(),'wrong'),e)).status).toBe(401);expect(e.AI.run).not.toHaveBeenCalled();});
 it('fails closed when no server secret configured',async()=>{const e=env();e.AI_PROXY_SECRET='';expect((await worker.fetch(request(body()),e)).status).toBe(401);});
 it('rejects another model and tools',async()=>{const e=env();expect((await worker.fetch(request({...body(),model:'other'}),e)).status).toBe(400);expect((await worker.fetch(request({...body(),tools:[]}),e)).status).toBe(400);expect(e.AI.run).not.toHaveBeenCalled();});
 it('enforces input/output caps',async()=>{const e=env();expect((await worker.fetch(request({...body(),messages:[{role:'user',content:'x'.repeat(21001)}]}),e)).status).toBe(413);expect((await worker.fetch(request({...body(),max_completion_tokens:1201}),e)).status).toBe(400);expect(e.AI.run).not.toHaveBeenCalled();});
 it('enforces body caps independently of declared content length',async()=>{const e=env();expect((await worker.fetch(request({...body(),extra:'x'.repeat(100000)}),e)).status).toBe(413);});
 it('returns OpenAI-compatible strict facts and usage',async()=>{const e=env({response:{facts:[{page:1,quote:'septic plan',value:'septic plan',node_id:'S0'}]},usage:{prompt_tokens:20,completion_tokens:30}});const r=await worker.fetch(request(body()),e);expect(r.status).toBe(200);const data=await r.json() as any;expect(JSON.parse(data.choices[0].message.content).facts[0].node_id).toBe('S0');expect(data.usage.total_tokens).toBe(50);expect(e.AI.run).toHaveBeenCalledWith(MODEL,expect.objectContaining({max_tokens:1200,stream:false,response_format:expect.objectContaining({type:'json_schema'})}));});
 it('rejects malformed facts and never fabricates usage',async()=>{const bad=env({response:{facts:[{page:1,value:'approved'}]}});expect((await worker.fetch(request(body()),bad)).status).toBe(502);const good=env({response:'{"facts":[]}'});const data=await (await worker.fetch(request(body()),good)).json() as any;expect(data.usage).toBeUndefined();});
 it('fails safely when allocation or model service unavailable',async()=>{const e=env();vi.mocked(e.AI.run).mockRejectedValueOnce(new Error('daily quota'));expect((await worker.fetch(request(body()),e)).status).toBe(503);});
});

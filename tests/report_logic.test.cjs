const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert'),path=require('node:path');
const h=fs.readFileSync(path.join(__dirname,'../docs/research/Davapprove_Kitsap_Approval_Dependency_Graph.html'),'utf8');
const script=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const elements={scenario:{value:'upland'}};
const ctx={document:{getElementById:id=>elements[id]??(elements[id]={}),querySelectorAll:()=>[]},console};
vm.createContext(ctx);vm.runInContext(script,ctx);
function run(s){return vm.runInContext(s,ctx)}
assert.equal(run("evaluate('start').ok"),false);
run("states.septic='accepted'");assert.equal(run("evaluate('start').ok"),true);
run("states.base='stale'");assert.equal(run("evaluate('start').ok"),false);
run("document.getElementById('scenario').value='shore';reset()");
assert.equal(run("evaluate('start').why.join(',')"),'wait,consult');
run("states.wait='accepted';states.consult='accepted'");assert.equal(run("evaluate('start').ok"),true);
run("states.rights='unknown'");assert.equal(run("evaluate('start').ok"),false);
run("states.rights='denied'");assert.equal(run("evaluate('start').ok"),false);
run("states.rights='expired'");assert.equal(run("evaluate('start').ok"),false);
run("document.getElementById('scenario').value='adu';reset()");assert.equal(run("evaluate('issue').why.join(',')"),'septic');
const registry=JSON.parse(h.match(/<script id="registry" type="application\/json">([\s\S]*?)<\/script>/)[1]);
assert.equal(registry.nodes.length,43);assert.equal(new Set(registry.nodes.map(n=>n.id)).size,43);
for(const n of registry.nodes)for(const s of n.sources)assert(registry.sources[s]);
const ids=new Set([...h.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
for(const m of h.matchAll(/href="#([^"]+)"/g))assert(ids.has(m[1]),m[1]);
console.log('PASS: 9 gate assertions; 43 unique nodes; all node sources and internal links resolve; script initialization and rendering succeed with DOM stub.');

assert.deepStrictEqual(registry, JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/research/kitsap-node-register.json'),'utf8')));
console.log('PASS: exported JSON matches the embedded report registry.');

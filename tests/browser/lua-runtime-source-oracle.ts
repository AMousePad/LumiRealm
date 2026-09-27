import ts from 'typescript';
import { LuaFactory } from 'wasmoon';
import assert from 'node:assert/strict';
import { makeRisuTriggerRuntime } from '../../src/interpreter/runtime';
import { execute, clearLuaEngines } from '../../src/interpreter/lua-bridge';
import { runListenEditChain } from '../../src/interpreter/listen-edit';
import { makeLuaDivergenceHost } from '../helpers/lua-risu-divergence';
import { basicTriggerContext } from '../helpers/trigger-runtime';

const risuDir = process.env.RISUAI_DIR;
if (!risuDir) throw new Error('Set RISUAI_DIR to the Risu checkout.');
const revision = Bun.spawnSync(['git', '-C', risuDir, 'rev-parse', 'HEAD']).stdout.toString().trim();
if (revision !== '669b12ceabe1c5066d3dadbe0973f2188d10cc97') throw new Error('The Risu oracle revision changed; review its caller contracts first.');
const source = await Bun.file(risuDir + '/src/ts/process/scriptings.ts').text();
const ast = ts.createSourceFile('scriptings.ts', source, ts.ScriptTarget.Latest, true);
const stripped = ast.statements.filter(s => !ts.isImportDeclaration(s) && !(ts.isClassDeclaration(s) && s.name?.text === 'PyodideContext')).map(s => s.getFullText(ast)).join('\n').replace(/^export /gm, '');
const mutex = (await Bun.file(risuDir + '/src/ts/mutex.ts').text()).replace(/^export /gm, '');
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(mutex + '\n' + stripped);
const factory = new LuaFactory();
await factory.mountFile('json.lua', await Bun.file(risuDir + '/public/lua/json.lua').text());
const wrapperStart = source.indexOf('return `', source.indexOf('function luaCodeWrapper(code:string)')) + 8;
assert.equal((await Bun.file('src/interpreter/lua-wrapper.lua').text()).replace(/\r\n/g, '\n'), source.slice(wrapperStart, source.indexOf('${code}', wrapperStart)).replace(/\r\n/g, '\n'));

export function oracle(parse?: (text: string, options: unknown) => string) {
  const chat: any = { message: [{ role: 'user', data: 'Hello', time: 1700000000000 }, { role: 'char', data: 'Welcome', time: 1700000005000 }], scriptstate: { $x: '2' } };
  const char: any = { type: 'character', name: 'Character', desc: 'Description', firstMessage: 'Greeting', chatPage: 0, chats: [chat], triggerscript: [] };
  const db = { characters: [char] }; const errors: string[] = [];
  const env: any = {
    factory, getCurrentCharacter: () => char, getCurrentChat: () => chat,
    getChatVar: (key: string) => String(chat.scriptstate['$' + key] ?? 'null'),
    setChatVar: (key: string, value: unknown) => { const changed = chat.scriptstate['$' + key] !== value; chat.scriptstate['$' + key] = value; return changed; },
    getGlobalChatVar: () => 'null', getModuleTriggers: () => [],
    risuChatParser: parse ?? ((text: string) => text.replaceAll('{{char}}', char.name)),
    getDatabase: () => db, DBState: { db }, get: () => 0, selectedCharID: 0,
    v4: () => crypto.randomUUID(), console: { log() {}, error: (error: unknown) => errors.push(String(error)) },
  };
  const api = new Function(...Object.keys(env), '"use strict";\n' + compiled + '\nluaFactory=factory; return { runScripted,runLuaEditTrigger,close:()=>{for(const state of ScriptingEngines.values())state.engine?.global.close()} };')(...Object.values(env));
  return { ...api, chat, char, errors };
}

if (import.meta.main) {
  const cases = [
    `function onStart(id) return _VERSION..'|'..tostring(math.maxinteger) end`,
    `onStart=async(function(id) return false end)`,
    `function onStart(id) local list={'b','a'}; table.sort(list,function(a,b) return cbs(a)<cbs(b) end); return table.concat(list) end`,
    `local n=cbs('{{char}}'); function onStart(id) return n end`,
    `function onStart(id) setName(id,'changed'); return getName(id)..'|'..cbs('{{char}}') end`,
    `function onStart(id) setChatVar('forged','x','no'); return getChatVar(id,'x') end`,
    `function onStart(id) return getChat(id,-0.5).data..'|'..getRecentChats(id,1)[1].data end`,
    `function onStart(id) return type(setStateChanged(id,'x',1))..'|'..type(setStateChanged(id,'x',1)) end`,
    `function onStart(id) stopChat(id) end`,
    `function onStart(id) local ok=pcall(getState,id,'x');return ok end`,
  ];
  let count = 0;
  for (const code of cases) {
    const r = oracle(); const host = makeLuaDivergenceHost(); await clearLuaEngines();
    for (let i=0;i<2;i++) {
      const expected = await r.runScripted(code,{mode:'start'});
      const rt=await makeRisuTriggerRuntime(host.api,{characterId:'test-character'}, {require:async()=>({execute})}, {
        binding:'start', characterId:'test-character', templateContext:basicTriggerContext,
      });
      const actual=await rt.runLua(code);await rt.flush();
      assert.deepEqual({res:actual,stopSending:rt.stopSending},{res:expected.res,stopSending:expected.stopSending},code);
      count++;
    }
    r.close();
  }
  for (const mode of ['editDisplay','editInput','editOutput','editRequest'] as const) {
    for(const codes of [
      ["function callListenMain() return 'invalid JSON' end"],
      ["function callListenMain() return false end"],
      [`listenEdit('${mode}',function(id,v) setChatVar(id,'x','7');return v end)`, `listenEdit('${mode}',function(id,v) return getChatVar(id,'x') end)`],
      [`listenEdit('${mode}',function(id,v) return 'first' end)`, "error('chunk')", `listenEdit('${mode}',function(id,v) return 'last' end)`],
      [`listenEdit('${mode}',function(id,v) return 'first' end)`, `listenEdit('${mode}',function(id,v) error('callback') end)`, `listenEdit('${mode}',function(id,v) return v..'last' end)`],
      [`listenEdit('${mode}',function(id,v) setChat(id,0,'changed'); return getChatData(id,0)..'|'..type(getDescription(id)) end)`],
      [`listenEdit('${mode}',function(id,v) setDescription(id,'changed'); return getDescription(id) end)`],
      [`n=0; listenEdit('${mode}',function(id,v) n=n+1;return tostring(n) end)`,'',`n=0; listenEdit('${mode}',function(id,v) n=n+1;return tostring(n) end)`],
    ]) {
      const r=oracle(); const host=makeLuaDivergenceHost(); await clearLuaEngines();
      r.char.triggerscript=codes.map(code=>({effect:[{type:'triggerlua',code}]}));
      const input:any=mode==='editRequest'?[{role:'user',content:'Input'}]:'Input';
      const expected=await r.runLuaEditTrigger(r.char,mode,input,{});
      const actual=await runListenEditChain(codes.map(luaCode=>({source:{effect:[{type:'triggerlua'}]},luaCode})),mode,input,{},host.api,{characterId:'test-character'},{require:async()=>({execute})},{characterId:'test-character',preloaded:host.preloaded,templateContext:basicTriggerContext});
      assert.deepEqual(actual,expected,JSON.stringify({mode,codes}));
      assert.deepEqual(host.metadata.chat_variables,Object.fromEntries(Object.entries(r.chat.scriptstate).map(([k,v])=>[k.slice(1),v])));
      count++;r.close();
    }
  }
  console.log(JSON.stringify({source:revision,checks:count,passed:true,wrapperVerbatim:true}));
}

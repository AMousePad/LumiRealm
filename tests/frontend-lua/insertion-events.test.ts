import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { FrontendRuntimeState } from '../../src/frontend-lua/state';
import type { RuntimeStateDto, RuntimeStateWrite } from '../../src/frontend-lua/state-contract';

test.each([false, true])('insertion optimistic ordering and multi-event acknowledgement boundary, direct=%s',async direct=>{
  const dto:RuntimeStateDto={revision:{epoch:'host',sequence:1},chat:{id:'chat',metadata:{}},character:{id:'character'},persona:null,
    messages:[{id:'greeting',role:'assistant',content:'Greeting',index_in_chat:0},
      {id:'user',role:'user',content:'Hello',index_in_chat:1},
      {id:'reply',role:'assistant',content:'Welcome',index_in_chat:2}],lore:[],globalVariables:{}};
  const reply=Promise.withResolvers<RuntimeStateWrite>();let mutationId='';
  const state=new FrontendRuntimeState(dto,async(_command,id)=>{mutationId=id;return reply.promise;},()=>{});
  const view=state.luaChat();
  if (!direct) view.messages.splice(0,0,{id:'inserted',role:'user',content:'Inserted'});
  const command = {kind:'message.create' as const,id:'inserted',role:'user',content:'Inserted',beforeId:'user'};
  const pending=direct ? state.write(command) : view.enqueue!(async()=>{await state.write(command,false);});
  const immediate=state.messages.map(m=>m.content);
  await Promise.resolve();
  state.apply({epoch:'host',sequence:2},{message:{...dto.messages[1]!,index_in_chat:2}},mutationId);
  state.apply({epoch:'host',sequence:3},{message:{...dto.messages[2]!,index_in_chat:3}},mutationId);
  const inserted={id:'inserted',role:'user',content:'Inserted',index_in_chat:1};
  state.apply({epoch:'host',sequence:4},{message:inserted},mutationId);
  state.apply({epoch:'host',sequence:5},{message:{...inserted,content:'Native edit'}});
  const committedThenNative=state.messages.map(m=>m.content);
  reply.resolve({revision:{epoch:'host',sequence:4},patch:{message:inserted},value:undefined});await pending;
  const afterReply=state.messages.map(m=>m.content);
  assert.deepEqual(immediate,['Inserted','Hello','Welcome']);
  assert.deepEqual(committedThenNative,['Native edit','Hello','Welcome']);
  assert.deepEqual(afterReply,['Native edit','Hello','Welcome']);
});

test('active display views track inserted positions while retaining unchanged raw display content', () => {
  const dto: RuntimeStateDto = { revision: { epoch: 'host', sequence: 1 }, chat: { id: 'chat', metadata: {} }, character: { id: 'character' }, persona: null,
    messages: [{ id: 'greeting', role: 'assistant', content: 'Greeting', index_in_chat: 0 },
      { id: 'user', role: 'user', content: 'Hello', index_in_chat: 1 }, { id: 'reply', role: 'assistant', content: 'Saved reply', index_in_chat: 2 }], lore: [], globalVariables: {} };
  const state = new FrontendRuntimeState(dto, async () => { throw new Error('Unexpected write'); }, () => {});
  const display = state.displayChat(state.hostMessages().map(message => message.id === 'reply' ? { ...message, content: 'Raw display input' } : message), undefined);
  try {
    state.apply({ epoch: 'host', sequence: 2 }, { message: { ...dto.messages[1]!, index_in_chat: 2 } });
    state.apply({ epoch: 'host', sequence: 3 }, { message: { ...dto.messages[2]!, index_in_chat: 3 } });
    state.apply({ epoch: 'host', sequence: 4 }, { message: { id: 'new', role: 'user', content: 'Inserted', index_in_chat: 1 } });
    assert.deepEqual(display.chat.messages.map(message => message.content), ['Inserted', 'Hello', 'Raw display input']);
    state.apply({ epoch: 'host', sequence: 5 }, { message: { ...dto.messages[2]!, content: 'Native edit', index_in_chat: 3 } });
    assert.deepEqual(display.chat.messages.map(message => message.content), ['Inserted', 'Hello', 'Native edit']);
  } finally { display.release(); }
});

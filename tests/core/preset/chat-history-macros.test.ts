import { expect, test } from 'bun:test';
import { transformPresetTemplate } from '../../../src/core/preset/risup-translator';

test('Risu message index macros replace the host macros of the same name', () => {
  for (const [source, target] of [
    ['{{lastmessageid}}', '{{risuLastMessageId}}'], ['{{lastmessageindex}}', '{{risuLastMessageId}}'],
    ['{{lastMessageId}}', '{{risuLastMessageId}}'], ['{{last_message_id}}', '{{risuLastMessageId}}'],
    ['{{previous_chat_log::1}}', '{{risuChatLog::1}}'], ['{{previouschatlog::1}}', '{{risuChatLog::1}}'],
    ['{{previousChatLog::1}}', '{{risuChatLog::1}}'],
    ['{{previous_chat_log:{{lastmessageid}}}}', '{{risuChatLog::{{risuLastMessageId}}}}'],
    ['{{previous_chat_log ::{{lastmessageid}}}}', '{{risuChatLog::{{risuLastMessageId}}}}'],
    ['{{previous_chat_log::{{lastmessageid }}}}', '{{risuChatLog::{{risuLastMessageId}}}}'],
    ['{{previous_chat_log::{{ lastmessageid }}}}', '{{risuChatLog::{{risuLastMessageId}}}}'],
    ['{{lastmessageid::ignored}}', '{{risuLastMessageId}}'], ['{{last message-id}}', '{{risuLastMessageId}}'],
    // A bare read has no index in Risu either, and prefixes of these names are other macros.
    ['{{previous_chat_log}}', '{{previous_chat_log}}'], ['{{lastmessageids}}', '{{lastmessageids}}'],
    ['{{lastmessage}}', '{{lastmessage}}'],
  ]) {
    expect(transformPresetTemplate(source!)).toBe(target!);
  }
});

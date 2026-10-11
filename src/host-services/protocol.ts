import type { ActivationPatternsOptions, ActivationPatternsResult, CharacterDTO, RegexScriptDTO, RegexScriptListOptionsDTO, SpindleFileRef } from 'lumiverse-spindle-types';

export interface HostOperations {
  'activation.prepare': { input: Omit<ActivationPatternsOptions, 'userId'>; output: ActivationPatternsResult };
  'regex.list': { input: Omit<RegexScriptListOptionsDTO, 'userId'>; output: { data: RegexScriptDTO[]; total: number } };
  'regex.delete': { input: { ids: string[] }; output: number };
  'worldbook.delete': { input: { id: string }; output: boolean };
  'character.get': { input: { id: string }; output: CharacterDTO | null };
  'character.linkBooks': { input: { id: string; worldBookIds: string[] }; output: void };
  'translation': { input: { text: string; source: string }; output: { status: number; body: string } };
  'file.create': { input: { name: string; size: number; mimeType: string }; output: SpindleFileRef };
  'file.write': { input: { id: string; offset: number; base64: string }; output: number };
  'file.finish': { input: { id: string }; output: SpindleFileRef };
  'file.delete': { input: { id: string }; output: boolean };
  'image.upload': { input: { fileId: string; name: string; mimeType: string }; output: string };
}

export type HostRequest = { [K in keyof HostOperations]: {
  type: 'host_service'; requestId: string; operation: K; input: HostOperations[K]['input'];
} }[keyof HostOperations];
export type HostReply = { type: 'host_service_reply'; requestId: string } & (
  { ok: true; value: unknown } | { ok: false; error: string }
);

export class HostServiceError extends Error {
  override readonly name = 'HostServiceError';
}

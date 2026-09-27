// Polling and exporting diagnostics must not add more diagnostics to the buffer.
export function isLogTransportNoise(type: string): boolean {
  return type === 'log_request_state' || type === 'log_state_pushed' || type === 'log_export_pushed';
}

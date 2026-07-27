import { Buffer } from 'node:buffer';

export const NATIVE_HOST_NAME = 'com.glossitylabs.formatforge';
export const NATIVE_PROTOCOL_VERSION = 1;
export const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024;

export interface BootstrapRequest {
  type: 'bootstrap';
  protocolVersion: 1;
}

export interface BootstrapResult {
  type: 'bootstrapResult';
  protocolVersion: 1;
  baseUrl: string;
  token: string;
  service: string;
  version: string;
  apiVersion: number;
}

export interface BootstrapError {
  type: 'bootstrapError';
  protocolVersion: 1;
  code: 'invalid_request' | 'engine_unavailable' | 'version_conflict' | 'internal_error';
  message: string;
}

export type NativeHostResponse = BootstrapResult | BootstrapError;

export function isBootstrapRequest(value: unknown): value is BootstrapRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Record<string, unknown>;
  return request.type === 'bootstrap' && request.protocolVersion === NATIVE_PROTOCOL_VERSION;
}

export function encodeNativeMessage(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > MAX_NATIVE_MESSAGE_BYTES) {
    throw new Error('Native message exceeds the one-megabyte host limit.');
  }
  const frame = Buffer.allocUnsafe(4 + body.length);
  frame.writeUInt32LE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

export class NativeMessageDecoder {
  #buffer = Buffer.alloc(0);

  push(chunk: Uint8Array): unknown[] {
    this.#buffer = Buffer.concat([this.#buffer, Buffer.from(chunk)]);
    const messages: unknown[] = [];

    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32LE(0);
      if (length > MAX_NATIVE_MESSAGE_BYTES) {
        throw new Error('Native message exceeds the one-megabyte host limit.');
      }
      if (this.#buffer.length < length + 4) break;
      const body = this.#buffer.subarray(4, length + 4).toString('utf8');
      this.#buffer = this.#buffer.subarray(length + 4);
      messages.push(JSON.parse(body) as unknown);
    }
    return messages;
  }

  finish(): void {
    if (this.#buffer.length !== 0) throw new Error('Native message ended before its frame was complete.');
  }
}

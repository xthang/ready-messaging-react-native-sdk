import { Buffer } from 'buffer'

export function fromBase64(value: string): Uint8Array {
  return Buffer.from(value, 'base64')
}

export function fromHex(value: string): Uint8Array {
  return Buffer.from(value, 'hex')
}

// TODO(indutny): deprecate it
export function fromBinary(value: string): Uint8Array {
  return Buffer.from(value, 'binary')
}

export function fromString(value: string): Uint8Array {
  return Buffer.from(value)
}

export function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64')
}

export function toHex(data: Uint8Array): string {
  return Buffer.from(data).toString('hex')
}

// TODO(indutny): deprecate it
export function toBinary(data: Uint8Array): string {
  return Buffer.from(data).toString('binary')
}

export function toString(data: Uint8Array): string {
  return Buffer.from(data).toString()
}

export function byteLength(value: string): number {
  return Buffer.byteLength(value)
}

export function concatenate(list: ReadonlyArray<Uint8Array>): Uint8Array {
  return Buffer.concat(list)
}

export function isEmpty(data: Uint8Array | null | undefined): boolean {
  if (!data) {
    return true
  }
  return data.length === 0
}

export function isNotEmpty(data: Uint8Array | null | undefined): data is Uint8Array {
  return !isEmpty(data)
}

export function areEqual(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean {
  if (!a || !b) {
    return !a && !b
  }

  return Buffer.compare(a, b) === 0
}

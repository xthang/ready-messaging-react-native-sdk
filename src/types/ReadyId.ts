import { strictAssert } from 'utils/assert'

export type ReadyAddressStringType = string

const READY_ADDRESS_REGEXP = /^0x[0-9A-F]{64}$/i

export const isValidReadyId = (value: unknown): value is ReadyAddressStringType => {
  if (typeof value !== 'string') {
    return false
  }

  return READY_ADDRESS_REGEXP.test(value)
}

/* eslint-disable no-dupe-class-members */
export class ReadyAddress {
  constructor(protected readonly value: string) {
    strictAssert(isValidReadyId(value), `Invalid ReadyAddress: ${value}`)
  }

  public toString(): ReadyAddressStringType {
    return this.value as ReadyAddressStringType
  }

  public isEqual(other: ReadyAddress): boolean {
    return this.value === other.value
  }

  public static parse(value: string): ReadyAddress {
    return new ReadyAddress(value)
  }

  public static lookup(identifier: string): ReadyAddress | undefined {
    const account = window.Ready.utils.getCurrentAccount()
    const conversation = window.Ready.conversationController.getByIdentifier(account.id, identifier)
    const identifier_ = conversation?.get('identifier')
    if (identifier_ === undefined) {
      return undefined
    }

    return new ReadyAddress(identifier_)
  }

  public static checkedLookup(identifier: string): ReadyAddress {
    const uuid = ReadyAddress.lookup(identifier)
    strictAssert(uuid !== undefined, `Conversation ${identifier} not found or has no identifier`)
    return uuid
  }

  public static cast(value: ReadyAddressStringType): never

  public static cast(value: string): ReadyAddressStringType

  public static cast(value: string): ReadyAddressStringType {
    return new ReadyAddress(value.toLowerCase()).toString()
  }

  // For testing
  public static fromPrefix(value: string): ReadyAddress {
    let padded = value
    while (padded.length < 8) {
      padded += '0'
    }
    return new ReadyAddress(`${padded}-0000-4000-8000-${'0'.repeat(12)}`)
  }
}

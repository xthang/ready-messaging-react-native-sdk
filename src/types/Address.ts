// Copyright 2023 Ready.io

import { strictAssert } from 'utils/assert'
import { ReadyAddress, type ReadyAddressStringType } from './ReadyId'

export type AddressStringType = `${ReadyAddressStringType}.${number}`

const ADDRESS_REGEXP = /^([0-9a-f-]+).(\d+)$/i

export class Address {
  constructor(public readonly identifier: ReadyAddress, public readonly deviceId: number) {}

  public toString(): AddressStringType {
    return `${this.identifier.toString()}.${this.deviceId}`
  }

  public static parse(value: string): Address {
    const match = value.match(ADDRESS_REGEXP)
    strictAssert(match != null, `Invalid Address: ${value}`)
    const [whole, identifier, deviceId] = match!
    strictAssert(whole === value, 'Integrity check')
    return Address.create(identifier!, parseInt(deviceId!, 10))
  }

  public static create(identifier: string, deviceId: number): Address {
    return new Address(new ReadyAddress(identifier), deviceId)
  }
}

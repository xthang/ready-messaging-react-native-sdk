// Copyright 2023 Ready.io

/* eslint-disable import/no-unused-modules */

import { strictAssert } from 'utils/assert'
import { type AccountIdStringType } from './Account'
import type { AddressStringType } from './Address'
import { Address } from './Address'
import { ReadyAddress } from './ReadyId'

const QUALIFIED_ADDRESS_REGEXP = /^([0-9a-z]+):(0x[0-9a-f]+).(\d+)$/i

export type QualifiedAddressCreateOptionsType = Readonly<{
  ourUuid: string
  identifier: string
  deviceId: number
}>

export type QualifiedAddressStringType = `${AccountIdStringType}:${AddressStringType}`

export class QualifiedAddress {
  constructor(public readonly ourAccountId: AccountIdStringType, public readonly address: Address) {}

  public get identifier(): ReadyAddress {
    return this.address.identifier
  }

  public get deviceId(): number {
    return this.address.deviceId
  }

  public toString(): QualifiedAddressStringType {
    return `${this.ourAccountId.toString()}:${this.address.toString()}`
  }

  public static parse(value: string): QualifiedAddress {
    const match = value.match(QUALIFIED_ADDRESS_REGEXP)
    strictAssert(match != null, `Invalid QualifiedAddress: ${value}`)
    const [whole, ourAccountId, accountId, deviceId] = match
    strictAssert(whole === value, 'Integrity check')

    return new QualifiedAddress(ourAccountId!, Address.create(accountId!, parseInt(deviceId!, 10)))
  }
}

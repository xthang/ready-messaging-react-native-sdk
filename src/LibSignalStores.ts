// Copyright 2023 Ready.io

import type {
  Direction,
  PreKeyRecord,
  ProtocolAddress,
  SessionRecord,
  SignedPreKeyRecord,
} from '@readyio/lib-messaging'
import {
  IdentityKeyStore,
  PreKeyStore,
  PrivateKey,
  PublicKey,
  SessionStore,
  SignedPreKeyStore,
  type KeyPairType,
} from '@readyio/lib-messaging'
import { isNumber } from 'lodash'

import { freezePreKey } from './SignalProtocolStore'
import { type AccountIdStringType } from './types/Account'
import { Address } from './types/Address'
import { QualifiedAddress } from './types/QualifiedAddress'
import type { Zone } from './utils/Zone'

function encodeAddress(address: ProtocolAddress): Address {
  return Address.create(address.name, address.deviceId)
}

function toQualifiedAddress(ourAccountId: AccountIdStringType, address: ProtocolAddress): QualifiedAddress {
  return new QualifiedAddress(ourAccountId, encodeAddress(address))
}

export type SessionsOptions = Readonly<{
  ourId: AccountIdStringType
  zone?: Zone
}>

export class Sessions extends SessionStore {
  private readonly ourId: AccountIdStringType

  private readonly zone: Zone | undefined

  constructor({ ourId, zone }: SessionsOptions) {
    super()

    this.ourId = ourId
    this.zone = zone
  }

  async saveSession(address: ProtocolAddress, record: SessionRecord): Promise<void> {
    await window.Ready.protocol.storeSession(toQualifiedAddress(this.ourId, address), record, {
      zone: this.zone,
    })
  }

  async getSession(name: ProtocolAddress): Promise<SessionRecord | null> {
    const encodedAddress = toQualifiedAddress(this.ourId, name)
    const record = await window.Ready.protocol.loadSession(encodedAddress, {
      zone: this.zone,
    })

    return record || null
  }

  async getExistingSessions(addresses: Array<ProtocolAddress>): Promise<Array<SessionRecord>> {
    const encodedAddresses = addresses.map((addr) => toQualifiedAddress(this.ourId, addr))
    return window.Ready.protocol.loadSessions(encodedAddresses, {
      zone: this.zone,
    })
  }
}

export type IdentityKeysOptions = Readonly<{
  ourId: AccountIdStringType
  zone?: Zone
}>

export class IdentityKeys extends IdentityKeyStore {
  private readonly ourId: AccountIdStringType

  private readonly zone: Zone | undefined

  constructor({ ourId, zone }: IdentityKeysOptions) {
    super()

    this.ourId = ourId
    this.zone = zone
  }

  getIdentityKeyPair(): KeyPairType {
    const pair = window.Ready.protocol.getIdentityKeyPair(this.ourId)!
    return {
      privKey: pair.privKey.buffer,
      pubKey: pair.pubKey.buffer,
    }
  }

  async getIdentityKey(): Promise<PrivateKey> {
    const keyPair = window.Ready.protocol.getIdentityKeyPair(this.ourId)
    if (!keyPair) {
      throw new Error('IdentityKeyStore/getIdentityKey: No identity key!')
    }
    return PrivateKey.deserialize(Buffer.from(keyPair.privKey))
  }

  async getLocalRegistrationId(): Promise<number> {
    const id = await window.Ready.protocol.getLocalRegistrationId(this.ourId)
    if (!isNumber(id)) {
      throw new Error('IdentityKeyStore/getLocalRegistrationId: No registration id!')
    }
    return id
  }

  async getIdentity(address: ProtocolAddress): Promise<PublicKey | null> {
    const encodedAddress = encodeAddress(address)
    const key = await window.Ready.protocol.loadIdentityKey(this.ourId, encodedAddress.identifier)

    if (!key) {
      return null
    }

    return PublicKey.deserialize(Buffer.from(key))
  }

  async saveIdentity(name: ProtocolAddress, key: PublicKey | Buffer): Promise<boolean> {
    const encodedAddress = encodeAddress(name)
    const publicKey = key instanceof PublicKey ? key.serialize() : key

    // Pass `zone` to let `saveIdentity` archive sibling sessions when identity
    // key changes.
    return window.Ready.protocol.saveIdentity(this.ourId, encodedAddress, publicKey, false, {
      zone: this.zone,
    })
  }

  async isTrustedIdentity(name: ProtocolAddress, key: PublicKey | Buffer, direction: Direction): Promise<boolean> {
    const encodedAddress = encodeAddress(name)
    const publicKey = key instanceof PublicKey ? key.serialize() : key

    return window.Ready.protocol.isTrustedIdentity(this.ourId, encodedAddress, publicKey, direction)
  }
}

export type PreKeysOptions = Readonly<{
  ourAccountId: AccountIdStringType
}>

export class PreKeys extends PreKeyStore {
  private readonly ourAccountId: AccountIdStringType

  constructor({ ourAccountId }: PreKeysOptions) {
    super()
    this.ourAccountId = ourAccountId
  }

  async savePreKey(id: number, record: PreKeyRecord): Promise<void> {
    await window.Ready.protocol.storePreKey(this.ourAccountId, id, freezePreKey(record))
  }

  async getPreKey(id: number): Promise<PreKeyRecord> {
    const preKey = await window.Ready.protocol.loadPreKey(this.ourAccountId, id)

    if (preKey === undefined) {
      throw new Error(`getPreKey: PreKey ${id} not found`)
    }

    return preKey
  }

  async removePreKey(id: number): Promise<void> {
    await window.Ready.protocol.removePreKey(this.ourAccountId, id)
  }
}

export type SenderKeysOptions = Readonly<{
  readonly ourAccountId: AccountIdStringType
  readonly zone: Zone | undefined
}>

// export class SenderKeys extends SenderKeyStore {
//   private readonly ourAccountId: AccountIdStringType

//   readonly zone: Zone | undefined

//   constructor({ ourAccountId, zone }: SenderKeysOptions) {
//     super()
//     this.ourAccountId = ourAccountId
//     this.zone = zone
//   }

//   async saveSenderKey(
//     sender: ProtocolAddress,
//     distributionId: Uuid,
//     record: SenderKeyRecord
//   ): Promise<void> {
//     const encodedAddress = toQualifiedAddress(this.ourAccountId, sender)

//     await window.Signal.protocol.saveSenderKey(encodedAddress, distributionId, record, {
//       zone: this.zone,
//     })
//   }

//   async getSenderKey(
//     sender: ProtocolAddress,
//     distributionId: Uuid
//   ): Promise<SenderKeyRecord | null> {
//     const encodedAddress = toQualifiedAddress(this.ourAccountId, sender)

//     const senderKey = await window.Signal.protocol.getSenderKey(encodedAddress, distributionId, {
//       zone: this.zone,
//     })

//     return senderKey || null
//   }
// }

export type SignedPreKeysOptions = Readonly<{
  ourAccountId: AccountIdStringType
}>

export class SignedPreKeys extends SignedPreKeyStore {
  private readonly ourAccountId: AccountIdStringType

  constructor({ ourAccountId }: SignedPreKeysOptions) {
    super()
    this.ourAccountId = ourAccountId
  }

  async saveSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void> {
    await window.Ready.protocol.storeSignedPreKey(this.ourAccountId, id, freezePreKey(record), true)
  }

  async getSignedPreKey(id: number): Promise<SignedPreKeyRecord> {
    const signedPreKey = await window.Ready.protocol.loadSignedPreKey(this.ourAccountId, id)

    if (!signedPreKey) {
      throw new Error(`getSignedPreKey: SignedPreKey ${id} not found`)
    }

    return signedPreKey
  }
}

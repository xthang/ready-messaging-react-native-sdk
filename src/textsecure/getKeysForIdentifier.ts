// Copyright 2023 Ready.io

/* eslint-disable import/no-unused-modules */

import {
  ErrorCode,
  LibSignalErrorBase,
  PreKeyBundle,
  processPreKeyBundle,
  ProtocolAddress,
  PublicKey,
} from '@readyio/lib-messaging'

import { type ChatDeviceType } from 'types/chat'
import { logger as log, logger } from 'utils/logger'
import { Sessions, IdentityKeys } from '../LibSignalStores'
import { type AccountIdStringType } from '../types/Account'
import { Address } from '../types/Address'
import { QualifiedAddress } from '../types/QualifiedAddress'
import { ReadyAddress, type ReadyAddressStringType } from '../types/ReadyId'
import { HTTPError, OutgoingIdentityKeyError, UnregisteredUserError } from './Errors'

type ServerKeysType = {
  identity_key: string
  devices: ChatDeviceType[]
  name: string
}

export async function getKeysForIdentifier(
  ourAccountId: AccountIdStringType,
  identifier: ReadyAddressStringType,
  devicesToUpdate?: Array<number>
): Promise<{ accessKeyFailed?: boolean; name?: string }> {
  logger.log(`--> getKeysForIdentifier: ${identifier} | devicesToUpdate: ${devicesToUpdate}`)

  try {
    const result = await window.Ready.api.getKeyBundle(identifier)

    if (result.kind === 'ok') {
      await handleServerKeys(ourAccountId, identifier, result.data, devicesToUpdate)

      return {
        accessKeyFailed: false,
        name: result.data.name,
      }
    }
    if (result.kind === 'not-found') {
      throw new UnregisteredUserError(identifier, new Error(`Not found for ${identifier}`))
    }

    throw new Error(`Failed to get keys for ${identifier}: ${JSON.stringify(result)}`)
  } catch (error) {
    if (error instanceof HTTPError && error.code === 404) {
      await window.Ready.protocol.archiveAllSessions(ReadyAddress.lookup(identifier)!)

      throw new UnregisteredUserError(identifier, error)
    }

    throw error
  }
}

export async function handleServerKeys(
  ourAccountId: AccountIdStringType,
  identifier: ReadyAddressStringType,
  response: ServerKeysType,
  devicesToUpdate?: Array<number>
): Promise<void> {
  // const name = response.name

  if (!response.identity_key) {
    throw new Error('user_has_no_main_wallet_to_chat')
  }

  const bundleDevices = response.devices.filter((d) => !!d.signed_pre_key.key_id)
  if (!bundleDevices.length) {
    throw new Error(`key_bundle_not_found`)
  }

  const sessionStore = new Sessions({ ourId: ourAccountId })
  const identityKeyStore = new IdentityKeys({ ourId: ourAccountId })

  await Promise.all(
    bundleDevices.map(async (device) => {
      const {
        device_user_id: deviceId,
        registration_id: registrationId,
        pre_key: preKeys,
        signed_pre_key: signedPreKey,
      } = device
      const preKey = preKeys?.[0]
      if (devicesToUpdate && !devicesToUpdate.includes(deviceId)) {
        return
      }

      if (registrationId === 0) {
        log.info(`handleServerKeys/${identifier}: Got device registrationId zero!`)
      }
      if (!signedPreKey) {
        throw new Error(`getKeysForIdentifier/${identifier}: Missing signed prekey for deviceId ${deviceId}`)
      }
      if (!signedPreKey.key_id) {
        log.info(`handleServerKeys/${identifier}: signedPreKey.key_id is empty`)
        return
      }
      const theirUuid = ReadyAddress.checkedLookup(identifier)
      const protocolAddress = new ProtocolAddress(theirUuid.toString(), deviceId)
      const preKeyId = preKey?.key_id || null
      const preKeyObject = preKey ? PublicKey.deserialize(Buffer.from(preKey.public_key, 'hex')) : null
      const signedPreKeyObject = PublicKey.deserialize(Buffer.from(signedPreKey.public_key, 'hex'))
      const identityKey = PublicKey.deserialize(Buffer.from(response.identity_key, 'hex'))

      const preKeyBundle = PreKeyBundle.new(
        registrationId,
        deviceId,
        preKeyId,
        preKeyObject,
        signedPreKey.key_id,
        signedPreKeyObject,
        Buffer.from(signedPreKey.signature, 'hex'),
        identityKey
      )

      const address = new QualifiedAddress(ourAccountId, new Address(theirUuid, deviceId))

      try {
        await window.Ready.protocol.enqueueSessionJob(address, () =>
          processPreKeyBundle(preKeyBundle, protocolAddress, sessionStore, identityKeyStore)
        )
      } catch (error) {
        if (error instanceof LibSignalErrorBase && error.code === ErrorCode.UntrustedIdentity) {
          throw new OutgoingIdentityKeyError(identifier, error)
        }
        throw error
      }
    })
  )
}

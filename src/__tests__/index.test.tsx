import { Environment, setEnvironment } from 'utils/environment'

setEnvironment(Environment.Test)

// ----------------------------------------

jest.mock('@nozbe/watermelondb/adapters/sqlite/makeDispatcher/index.native.js', () => {
  return jest.requireActual('@nozbe/watermelondb/adapters/sqlite/makeDispatcher/index.js')
})
jest.mock('@nozbe/watermelondb/utils/common/randomId/randomId.native.js', () => {
  return jest.requireActual('@nozbe/watermelondb/utils/common/randomId/randomId.js')
})
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native') // use original implementation, which comes with mocks out of the box

  // mock modules/components created by assigning to NativeModules
  RN.NativeModules.RNRandomBytes = {
    seed: jest.getSeed().toString(),
  }

  const mockSecureStorage: { [key: string]: string } = {}
  RN.NativeModules.RNSecureStorage = {
    get(key: string): string | null {
      return mockSecureStorage[key] || null
    },
    exists(key: string): boolean | null {
      return !!mockSecureStorage[key]
    },
    set(key: string, value: string, options: any): string | null {
      if (this.exists(key)) return null
      mockSecureStorage[key] = value
      return key
    },
    remove(key: string): string | null {
      if (this.exists(key)) return null
      delete mockSecureStorage[key]
      return key
    },
  }

  RN.NativeModules.MessagingProtocol = {
    createKeyPair: async (privateKey: number[] | null): Promise<number[][]> => {
      const keyPair = await crypto.createKeyPair(privateKey ? new Uint8Array(privateKey).buffer : undefined)
      return [Array.from(new Uint8Array(keyPair.privKey)), Array.from(new Uint8Array(keyPair.pubKey))]
    },
    verifySignature: async (
      publicKey: Array<number>,
      data: Array<number>,
      signature: Array<number>
    ): Promise<boolean> =>
      crypto.Ed25519Verify(
        new Uint8Array(publicKey).buffer,
        new Uint8Array(data).buffer,
        new Uint8Array(signature).buffer
      ),
    privateKeyAgreeWithOtherPublicKey: async (
      privateKey: Array<number>,
      publicKey: Array<number>
    ): Promise<Array<number>> =>
      Array.from(
        new Uint8Array(await crypto.ECDHE(new Uint8Array(publicKey).buffer, new Uint8Array(privateKey).buffer))
      ),
    decrypt: async (key: number[], data: number[], iv: number[]): Promise<number[]> =>
      Array.from(
        new Uint8Array(
          await crypto.decrypt(new Uint8Array(key).buffer, new Uint8Array(data).buffer, new Uint8Array(iv).buffer)
        )
      ),
  }

  return RN
})

// ----------------------------------------

import { uint8ArrayToString } from '@readyio/lib-messaging/react-native/src/helpers'
import { createKeyPair } from '@readyio/lib-messaging/react-native/src/internal/crypto'
import { conversationJobQueue } from 'jobs/conversationJobQueue'
import { ConversationModel } from 'models/conversations'
import { MessageModel } from 'models/messages'
import MessageSender from 'textsecure/MessageSender'
import { ServerApi, getGeneralApiProblem } from 'types/api'
import { SendChatMessageData, SendPublicGroupMessageData } from 'types/api/requests/chat'
import {
  EmtpyResult,
  GetChatKeyBundleResult,
  SendChatMessageResult,
  SendPublicChatMessageResult,
} from 'types/api/responses'
import { ConversationType, GroupType, MessageContentType, MessageType } from 'types/chat'
import * as Utils from 'utils/crypto/utils'
import { sleep } from 'utils/sleep'
import { crypto } from './mocks/signal/internal/crypto'

import 'setup'

// ----------------------------------------

window.Ready.types.Conversation = class Conversation extends ConversationModel {
  doAddSingleMessage(message: MessageModel, { isJustSent }: { isJustSent: boolean }): void {
    // throw new Error('Method not implemented.')
  }
  getMembersProfiles(tag: string): Promise<void> {
    throw new Error('Method not implemented.')
  }
}
window.Ready.types.Message = class Message extends MessageModel {
  onChange(): Promise<void> {
    return Promise.resolve()
  }
  onChangeId(oldValue: string, newValue: string): Promise<void> {
    return Promise.resolve()
  }
}

// ----------------------------------------

window.Ready.api.getKeyBundle = async (address: string, deviceId?: number): Promise<GetChatKeyBundleResult> => {
  const response = await fetch(`https://api.ready.io/chat/v2/keys/${address}/${deviceId || '*'}`, {
    method: 'get',
    headers: { Authorization: `Bearer ${apiToken}` },
  })

  if (!response.ok) {
    return getGeneralApiProblem(response)
  }

  const data = await response.json()
  // console.debug('*******', data)
  return { kind: 'ok', data }
}

// ----------------------------------------

const api: ServerApi = {
  sendMessage: async (payload: SendChatMessageData, destination: string): Promise<SendChatMessageResult> => {
    const response = await fetch(`https://api.ready.io/chat/v2/messages/${destination}`, {
      method: 'put',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      return getGeneralApiProblem(response)
    }

    const data = await response.json()
    return { kind: 'ok', data }
  },

  sendPublicGroupMessage: async (payload: SendPublicGroupMessageData): Promise<SendPublicChatMessageResult> => {
    const response = await fetch('https://api.ready.io/chat/v2/messages/groups_chat/public', {
      method: 'put',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      return getGeneralApiProblem(response)
    }

    const data = await response.json()
    return { kind: 'ok', data }
  },
  deletePublicGroupMessage: function (groupId: string, guid: string): Promise<EmtpyResult> {
    throw new Error('Function not implemented.')
  },
  deletePublicGroupAttachment: function (groupId: string, cloudUrl: string): Promise<EmtpyResult> {
    throw new Error('Function not implemented.')
  },
  reactMessagePublicGroup: function (groupId: string, guid: string, reaction: string): Promise<EmtpyResult> {
    throw new Error('Function not implemented.')
  },
}

window.Ready.messageSender = new MessageSender(api)

conversationJobQueue.streamJobs()

// ----------------------------------------

window.Ready.messageReceiver.addEventListener('message', (ev) => {
  console.log('<-- new message:', ev.data)
})

// ----------------------------------------

const apiToken =
  'cs.eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VybmFtZSI6IjB4MDE4YWQyNGRjZGYzNzZlMTA3YjA3YTNjMmQxNDdkOTA1NjM4NDgyMDc1YTI1OTFhYzA5MjA4YzEzMDE5NjM1YSIsImRldmljZV9pZCI6MTIsImNyZWF0ZWRfdGltZSI6MTY4OTU4OTU2OCwiZXhwaXJlZF90aW1lIjoxNjg5OTM1MTY4LCJ0b2tlbl90eXBlIjoiZGV2aWNlX2F1dGhlbnRpY2F0aW9uIiwic2NvcGUiOm51bGx9.2-dtSmK6Z-T-yeCCOBzJDLuKlNue11foZDoyi1L9CE8'
// Natural Minty: cs.eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VybmFtZSI6IjB4MDE4YWQyNGRjZGYzNzZlMTA3YjA3YTNjMmQxNDdkOTA1NjM4NDgyMDc1YTI1OTFhYzA5MjA4YzEzMDE5NjM1YSIsImRldmljZV9pZCI6MTIsImNyZWF0ZWRfdGltZSI6MTY4OTU4OTU2OCwiZXhwaXJlZF90aW1lIjoxNjg5OTM1MTY4LCJ0b2tlbl90eXBlIjoiZGV2aWNlX2F1dGhlbnRpY2F0aW9uIiwic2NvcGUiOm51bGx9.2-dtSmK6Z-T-yeCCOBzJDLuKlNue11foZDoyi1L9CE8
// Familiar: cs.eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VybmFtZSI6IjB4Yzk1ZDM0YTJmODk0MTYxMzQzZGI5YmFhMzVkYTFkNGY3MjY4YzYyYjg0MmE3YWIxMmYyM2ZjMWY2MzcwY2RmMSIsImRldmljZV9pZCI6MSwiY3JlYXRlZF90aW1lIjoxNjg5NTg1MzcwLCJleHBpcmVkX3RpbWUiOjE2ODk5MzA5NzAsInRva2VuX3R5cGUiOiJkZXZpY2VfYXV0aGVudGljYXRpb24iLCJzY29wZSI6bnVsbH0.g6twsXe73l73BiX1laU60lGbvk3S1Z2VzN8CWfvdeUQ
const accountAddress = '0x018ad24dcdf376e107b07a3c2d147d905638482075a2591ac09208c13019635a'
const account2Address = '0xc95d34a2f894161343db9baa35da1d4f7268c62b842a7ab12f23fc1f6370cdf1'
const privateKey = '9eb8a346406d4f44c5dd27a2f42742c736076568efff2e51a1c2227ed8248104'
const privateKey2 = 'ba2adbec50e36bbdfbb1c6e5fa10995658043070a8d9e86b523bcc54f4a444d2'

describe('test', () => {
  let accountId: string

  it('account', async () => {
    const keyPair = await createKeyPair(Utils.fromHexToArray(privateKey).buffer)

    accountId = await window.Ready.Data.createAccount({
      name: 'X-Test',
      address: accountAddress,
      avatar: '',
      customUsername: '',
      password: '',
      registrationId: 7947,
      deviceUserId: 12,
      privateKey: Utils.fromBufferToHex(keyPair.privKey),
      publicKey: Utils.fromBufferToHex(keyPair.pubKey),
    })

    await window.Ready.Data.createSignalSignedPreKey({
      accountId,
      keyId: 1,
      publicKey: '0597868f6a4fe2ecf9c86d5c58974a3a5287e85458cb5f0470b6d204e37c7c5146',
      privateKey: '88e0a600d3f7d4923ff817fa4abee08071004e67b4f250d363d51f9cd1882546',
    })

    await window.Ready.Data.createSignalPreKey({
      accountId,
      keyId: 1,
      publicKey: '05b2b0e0178f10bd5171037f5ae2a0d2a8774c633b90beaf11d955059fec00290e',
      privateKey: 'b0a633b51021d29eeaab7be8c22e2f67d7d583a5a1f94ccc1aaa0132c1785a7d',
    })

    window.Ready.protocol.hydrateCaches()

    window.utils.getCurrentAccount = () => ({
      id: accountId,
      address: accountAddress,
    })
  })

  test('send to public group', async () => {
    const conversation = await window.Ready.conversationController.getOrCreate(
      'jest-public',
      accountId,
      '84ca5018-bb7f-43e3-98b4-0aebf002386c',
      ConversationType.GROUP,
      GroupType.PUBLIC
    )
    const msg = await conversation.enqueueMessageForSend({ contentType: MessageType.MESSAGE, body: 'jest test text' })

    await sleep(1000)
  })

  test('encrypt and send to private conversation', async () => {
    const conversation = await window.Ready.conversationController.getOrCreate(
      'jest-private',
      accountId,
      account2Address,
      ConversationType.PRIVATE,
      undefined
    )
    const msg = await conversation.enqueueMessageForSend({
      contentType: MessageType.MESSAGE,
      body: 'jest test text out',
    })
    // await conversation.sendTypingMessage(true)

    await sleep(4000)
  }, 7000)

  test('decrypt', async () => {
    const message = uint8ArrayToString(
      Uint8Array.from([
        51, 40, 115, 8, 1, 48, 1, 18, 33, 5, 96, 2, 135, 191, 151, 181, 201, 243, 140, 97, 253, 27, 205, 183, 163, 92,
        223, 173, 91, 179, 128, 247, 182, 114, 97, 254, 162, 152, 164, 63, 41, 44, 26, 33, 5, 29, 213, 73, 13, 39, 5,
        134, 181, 173, 244, 0, 121, 75, 0, 40, 228, 243, 133, 125, 49, 139, 118, 156, 11, 135, 175, 250, 92, 25, 186,
        47, 124, 34, 227, 1, 51, 10, 33, 5, 27, 55, 93, 38, 218, 216, 141, 122, 21, 237, 137, 42, 68, 135, 1, 91, 88,
        67, 242, 99, 37, 9, 219, 106, 82, 233, 79, 117, 103, 0, 17, 86, 16, 0, 24, 0, 34, 176, 1, 215, 225, 71, 182,
        216, 69, 222, 198, 200, 70, 236, 18, 163, 236, 219, 107, 164, 16, 96, 111, 84, 59, 187, 205, 56, 178, 28, 26,
        254, 229, 119, 3, 133, 201, 4, 201, 7, 221, 214, 95, 138, 50, 210, 160, 38, 175, 147, 184, 2, 193, 117, 67, 254,
        63, 220, 240, 146, 76, 71, 159, 46, 11, 65, 110, 184, 118, 66, 52, 28, 229, 159, 60, 193, 206, 71, 0, 186, 180,
        36, 88, 133, 92, 134, 243, 0, 47, 21, 208, 243, 150, 243, 99, 55, 135, 36, 95, 150, 23, 91, 172, 212, 95, 125,
        113, 37, 30, 152, 57, 186, 13, 173, 147, 59, 228, 14, 134, 182, 139, 121, 246, 13, 60, 45, 204, 59, 77, 26, 131,
        160, 189, 62, 65, 140, 8, 17, 13, 143, 168, 161, 80, 137, 144, 197, 68, 96, 31, 40, 50, 131, 152, 249, 188, 226,
        8, 64, 211, 193, 75, 166, 152, 166, 101, 243, 1, 173, 62, 165, 113, 139, 16, 234, 74, 251, 25, 39, 206, 144, 46,
        199, 211, 55, 246, 170, 86,
      ])
    )

    window.Ready.messageReceiver.handleNewMessage({
      account: window.utils.getCurrentAccount(),
      envelope: {
        source: account2Address,
        source_device: 1,
        source_uuid: 'e090f20f-49f2-4ba7-9ee1-a3b9dbd32b38',
        destination_type: 'personal',
        destination_uuid: 'fb6c4adc-12ee-41ae-bff1-f373c4ff6945',
        // real_destination: null,
        guid: '33b24a45-48aa-4c3e-9cf4-5dbec74aafed',
        type: 3,
        content: MessageContentType.MESSAGE,
        legacy_message: message,
        message: '',
        server_timestamp: 1689583084,
        timestamp: 1689583082.912,
        ephemeral: true,
        relay: null,
        cached: false,
      },
    })

    await sleep(1000)
  })

  window.Ready.messageController.stopCleanupInterval()
})

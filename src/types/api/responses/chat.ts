import { ChatDeviceType } from 'types/chat'
import { GeneralApiProblem } from '..'

export type GetChatKeyBundleResult =
  | {
      kind: 'ok'
      data: {
        identity_key: string
        devices: ChatDeviceType[]
        name: string
      }
    }
  | GeneralApiProblem

export type SendChatMessageResult =
  | {
      kind: 'ok'
      data: {
        need_sync: boolean
        messages_info: {
          guid: string | null
        }[]
      }
    }
  | GeneralApiProblem

export type SendPublicChatMessageResult =
  | {
      kind: 'ok'
      data: {
        messages_info: {
          message_id: number
          guid: string | null
        }
      }
    }
  | GeneralApiProblem

/* eslint-disable import/no-unused-modules */

import { MessageContentType } from './chat'
import { type UUIDStringType } from './UUID'

export type SocketEnvelop = {
  message_id?: number // public group only
  type: number // not encrypted -> null
  guid: UUIDStringType
  destination_uuid: UUIDStringType
  destination_type: 'group' | 'personal'
  relay: null
  source: string // address
  source_uuid: UUIDStringType
  source_device: number // device user id
  message: string
  legacy_message: string
  content: MessageContentType
  timestamp: number // the timestamp value set when send the message
  server_timestamp: number // when server received the request
  cached: boolean
  ephemeral: true
  destination?: string // group id
  real_destination?: string
  is_pinned?: boolean
}

// Extension
export enum SocketEnvelopType {
  UNKNOWN = 0,
  PLAINTEXT_CONTENT = -100,
  CIPHERTEXT = 1,
  KEY_EXCHANGE = 2,
  PREKEY_BUNDLE = 3,
  RECEIPT = 5,
  UNIDENTIFIED_SENDER = 6,
  // And other signal types
}

export enum SocketEvent {
  NEW_MESSAGE = 'new_message',
  UPDATE_PUBLIC_MESSAGE = 'update_public_message',
  PUBLIC_GROUP_DELETED = 'public_group_deleted',
  PUBLIC_GROUP_INFO_UPDATED = 'public_group_info_updated',
  PUBLIC_GROUP_PERMISSIONS_UPDATED = 'public_group_permissions_updated',
  DEVICE_EVENT_SYNC_NEW_DEVICE = 'sync_new_device',
  DEVICE_EVENT_SYNC_DEVICE_FOUND = 'sync_device_found',
  LINK_DEVICE_ADD_NEW_DEVICE = 'link_device_add_new_device',
  LINK_DEVICE_KICKED = 'link_device_kicked',
  LINK_DEVICE_CHANGE_PRIMARY = 'link_device_change_primary',
  USER_EVENT_CHANGE_USERNAME = 'user_change_username',
  USER_EVENT_CHANGE_AVATAR = 'user_change_avatar',
}

export type DeletedGroupInfo = {
  id: string
}
export type UpdatedGroupInfo = {
  id: string
}
export type UpdatedGroupPermissionsInfo = {
  id: string
}

export type UpdateUsernameData = {
  custom_username: string
  first_name: string
  last_name: string
  username: string
  avatar: string
}

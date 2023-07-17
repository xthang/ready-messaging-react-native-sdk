import { Model, Query, Relation } from '@nozbe/watermelondb'
import { field, children, relation } from '@nozbe/watermelondb/decorators'
import { type Associations } from '@nozbe/watermelondb/Model'

// Base / Config / Var

// export class Item extends Model {
//   static table = 'items'

//   @field('json') json!: string
// }

// Account

export class Account extends Model {
  static table = 'accounts'

  static associations: Associations = {
    signal_pre_keys: {
      type: 'has_many',
      foreignKey: 'account_id',
    },
    signal_signed_pre_keys: {
      type: 'has_many',
      foreignKey: 'account_id',
    },
    contacts: {
      type: 'has_many',
      foreignKey: 'account_id',
    },
    conversations: {
      type: 'has_many',
      foreignKey: 'account_id',
    },
    wallets: {
      type: 'has_many',
      foreignKey: 'account_id',
    },
  }

  // @field('name') name!: string

  // @field('custom_username') customUsername!: string

  // @field('avatar') avatar!: string

  // @field('avatar_thumb') avatarThumb!: string

  @field('address') address!: string

  @field('password') password!: string

  @field('registration_id') registrationId!: number

  @field('device_user_id') deviceUserId!: number

  @field('public_key') publicKey!: string

  @field('private_key') privateKey!: string

  @children('signal_pre_keys') signalPreKeys!: Query<SignalPreKey>

  @children('signal_signed_pre_keys') signalSignedPreKeys!: Query<SignalSignedPreKey>

  @children('contacts') contacts!: Query<Contact>

  @children('conversations') conversations!: Query<Conversation>

  // @children('wallets') wallets!: Query<Wallet>
}

export class Contact extends Model {
  static table = 'contacts'

  static associations: Associations = {
    accounts: {
      type: 'belongs_to',
      key: 'account_id',
    },
  }

  @field('name') name!: string

  @field('custom_username') customUsername!: string

  @field('avatar') avatar!: string

  @field('avatar_thumb') avatarThumb!: string

  @field('address') address!: string

  @field('last_online') lastOnline!: number

  @field('nickname') nickname!: string

  @field('is_strange') isStrange!: boolean

  @field('is_deleted') isDeleted!: boolean

  @relation('accounts', 'account_id') account!: Relation<Account>
}

// Chat

export class UnprocessedData extends Model {
  static table = 'unprocessed_data'

  @field('guid') guid!: string

  @field('account_id') accountId!: string

  @field('version') version!: number

  @field('source') source!: string
  @field('source_uuid') sourceUuid!: string
  @field('source_device') sourceDevice!: number

  @field('destination_uuid') destinationUuid!: string | null
  @field('conversation_destination_address') conversationDestinationAdress!: string | null

  @field('envelope') envelope!: string
  @field('decrypted') decrypted!: string | null

  @field('timestamp') timestamp!: number
  @field('server_timestamp') serverTimestamp!: number
  @field('attempts') attempts!: number
  @field('message_age_sec') messageAgeSec!: number
  @field('urgent') urgent!: boolean

  @field('background') background!: boolean
}

export class Conversation extends Model {
  static table = 'conversations'

  static associations: Associations = {
    accounts: {
      type: 'belongs_to',
      key: 'account_id',
    },
    signal_sessions: {
      type: 'has_many',
      foreignKey: 'conversation_id',
    },
    // signal_identity_keys: {
    //   type: 'has_many',
    //   foreignKey: 'conversation_id',
    // },
    signal_devices: {
      type: 'has_many',
      foreignKey: 'conversation_id',
    },
    contacts: {
      type: 'has_many',
      foreignKey: 'conversation_id',
    },
    messages: {
      type: 'has_many',
      foreignKey: 'conversation_id',
    },
    attachments: {
      type: 'has_many',
      foreignKey: 'conversation_id',
    },
  }

  @field('identifier') identifier!: string

  @field('type') type!: number
  @field('group_type') groupType!: number | null

  @field('created_at') createdAt!: number

  @field('name') name!: string

  @field('last_seen') lastSeen!: number

  @field('last_read') lastRead!: number

  @field('description') description!: string

  @field('avatar') avatar!: string

  @field('mute_until') muteUntil!: number

  @field('no_push') noPush!: boolean

  @field('is_blocked') isBLocked!: boolean

  @field('is_account_deleted') isAccountDeleted!: boolean

  @children('signal_sessions') signalSessions!: Query<SignalSession>

  // @children('signal_identity_keys') signalIdentityKeys!: Query<SignalIdentityKey>

  @children('signal_devices') signalDevices!: Query<SignalDevice>

  @children('contacts') contacts!: Query<Contact>

  @children('messages') messages!: Query<Message>

  @children('attachments') attachments!: Query<Attachment>

  @relation('accounts', 'account_id') account!: Relation<Account>
}

export class Message extends Model {
  static table = 'messages'

  static associations: Associations = {
    conversations: {
      type: 'belongs_to',
      key: 'conversation_id',
    },
    attachments: {
      type: 'has_many',
      foreignKey: 'message_id',
    },
  }

  @field('guid') guid!: string
  @field('uuid') uuid!: string

  @field('created_at') createdAt!: number
  @field('deleted_at') deletedAt?: number

  @field('source_uuid') sourceUUID!: string
  @field('source') source!: string
  @field('source_device') sourceDevice!: number

  @field('type_') type!: 'outgoing' | 'incoming' | null

  @field('type') contentType!: number

  @field('body') body!: string | null
  @field('json') json!: string | null // to store all data related to sticker, gif, file, media, send token, request token, etc in JSON format
  @field('reactions') reactions!: string | null

  @field('reply_to') replyTo!: string | null
  @field('forward_to') quote!: string | null

  @field('is_pin') isPinned!: boolean

  @field('send_at') sentAt!: number | null
  @field('send_states') sendStates!: string | null
  @field('is_sent') isSent!: boolean | null

  @field('received_at') receivedAt!: number | null
  @field('receive_status') receiveStatus!: string | null

  @field('deleted_for_everyone_send_status') deletedForEveryoneSendStatus!: string | null
  @field('deleted_for_everyone_failed') deletedForEveryoneFailed!: boolean | null

  @children('attachments') attachments!: Query<Attachment>

  @relation('conversations', 'conversation_id') conversation!: Relation<Conversation>
}

export class Attachment extends Model {
  static table = 'attachments'

  static associations: Associations = {
    conversations: {
      type: 'belongs_to',
      key: 'conversation_id',
    },
    messages: {
      type: 'belongs_to',
      key: 'message_id',
    },
  }

  @field('type') type!: number

  @field('name') name!: string

  @field('cloud_url') cloudUrl!: string

  @field('local_url') localUrl!: string

  @field('secure') secure!: boolean

  @field('metadata') metadata!: string

  @field('decryption_key') decryptionKey!: string

  @field('created_at') createdAt!: number

  @field('size') size!: number

  @relation('conversations', 'conversation_id') conversation!: Relation<Conversation>

  @relation('messages', 'message_id') message!: Relation<Message>
}

// Signal

export class SignalPreKey extends Model {
  static table = 'signal_pre_keys'

  static associations: Associations = {
    accounts: {
      type: 'belongs_to',
      key: 'account_id',
    },
  }

  @field('key_id') keyId!: number

  @field('public_key') publicKey!: string

  @field('private_key') privateKey!: string

  @relation('accounts', 'account_id') account!: Relation<Account>
}

export class SignalSignedPreKey extends Model {
  static table = 'signal_signed_pre_keys'

  static associations: Associations = {
    accounts: {
      type: 'belongs_to',
      key: 'account_id',
    },
  }

  @field('key_id') keyId!: number

  @field('public_key') publicKey!: string

  @field('private_key') privateKey!: string

  @field('created_at') createdAt!: number

  @field('confirmed') confirmed!: boolean

  @relation('accounts', 'account_id') account!: Relation<Account>
}

export class SignalSession extends Model {
  static table = 'signal_sessions'

  static associations: Associations = {
    conversations: {
      type: 'belongs_to',
      key: 'conversation_id',
    },
  }

  @field('session_id') sessionId!: string

  @field('device_id') deviceId!: number

  @field('record') record!: string

  @relation('conversations', 'conversation_id') conversation!: Relation<Conversation>
}

export class SignalIdentityKey extends Model {
  static table = 'signal_identity_keys'

  // static associations: Associations = {
  //   conversations: {
  //     type: 'belongs_to',
  //     key: 'conversation_id',
  //   },
  // }

  @field('our_id') ourId!: string
  @field('their_id') theirId!: string
  @field('public_key') publicKey!: string
  @field('first_use') firstUse!: boolean
  @field('timestamp') timestamp!: number
  @field('verified') verified!: number
  @field('nonblocking_approval') nonblockingApproval!: boolean

  // @relation('conversations', 'conversation_id') conversation!: Relation<Conversation>
}

export class SignalDevice extends Model {
  static table = 'signal_devices'

  static associations: Associations = {
    conversations: {
      type: 'belongs_to',
      key: 'conversation_id',
    },
  }

  @field('contact_address') contactAddress!: string

  @field('device_user_id') deviceUserId!: number

  @field('registration_id') registrationId!: number

  @relation('conversations', 'conversation_id') conversation!: Relation<Conversation>
}

export class Job extends Model {
  static table = 'jobs'

  @field('queue_type') queueType!: string

  @field('timestamp') timestamp!: number

  @field('data') data!: string
}

import { Platform } from 'react-native'
import { Database } from '@nozbe/watermelondb'
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite'

import { logger } from 'utils/logger'
import { dbQueue } from 'utils/queue'
import migrations from './model/migrations'
import {
  Account,
  Contact,
  Conversation,
  Message,
  Attachment,
  SignalPreKey,
  SignalSignedPreKey,
  SignalIdentityKey,
  SignalSession,
  SignalDevice,
  UnprocessedData,
  Job,
} from './model/models'
import schema from './model/schema'

export const queue = dbQueue

const adapter = new SQLiteAdapter({
  schema,
  migrations,
  jsi: Platform.OS === 'ios',
  // (optional, but you should implement this method)
  onSetUpError: (error) => {
    logger.error(`watermelonDB.setup: ${error}`)
    // Database failed to load -- offer the user to reload the app or log out
  },
})

// Then, make a Watermelon database from it!
export const database = new Database({
  adapter,
  modelClasses: [
    Account,
    Contact,
    Attachment,
    Conversation,
    SignalPreKey,
    SignalSignedPreKey,
    SignalIdentityKey,
    SignalSession,
    SignalDevice,
    Job,
    UnprocessedData,
    Message,
  ],
})

// Debugging
if (__DEV__) {
  // Import connectDatabases function and required DBDrivers

  const { connectDatabases, WatermelonDB } = require('react-native-flipper-databases')

  connectDatabases([
    new WatermelonDB(database), // Pass in database definition
  ])
}

// Secure store
export const SecuredKeys = {
  accounts: ['password', 'privateKey'],
  wallets: ['privateKey', 'passphrase'],
}

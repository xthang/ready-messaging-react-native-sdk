import RNSecureStorage, { ACCESSIBLE } from 'rn-secure-storage'
import { logger } from '../logger'

const options = {
  accessible: ACCESSIBLE.WHEN_UNLOCKED,
}

/**
 * Loads something from storage and runs it thru JSON.parse.
 *
 * @param key The key to fetch.
 */
export async function loadSecure(key: string): Promise<any | null> {
  try {
    // if (__DEV__) {
    //   console.log(`Getting from SECURE key ${key}`)
    // }
    const almostThere = await RNSecureStorage.get(key)
    return JSON.parse(almostThere)
  } catch (e: any) {
    if (e?.code !== '404' && !e?.message.includes('ENOENT (No such file or directory)')) {
      logger.debug(e)
    }
    return null
  }
}

/**
 * Saves an object to storage.
 *
 * @param key The key to fetch.
 * @param value The value to store.
 */
export async function saveSecure(key: string, value: any): Promise<boolean> {
  try {
    // if (__DEV__) {
    //   console.log(`Saving to SECURE key ${key}`)
    // }
    await RNSecureStorage.set(key, JSON.stringify(value), options)
    return true
  } catch (e) {
    logger.debug(e)
    return false
  }
}

/**
 * Removes something from storage.
 *
 * @param key The key to kill.
 */
export async function removeSecure(key: string): Promise<void> {
  try {
    // if (__DEV__) {
    //   console.log(`Removing from SECURE key ${key}`)
    // }
    await RNSecureStorage.remove(key)
  } catch {
    //
  }
}

/**
 * Check if exists
 */
export async function hasSecure(key: string): Promise<boolean> {
  try {
    // if (__DEV__) {
    //   console.log(`Checking from SECURE key ${key}`)
    // }
    const res = await RNSecureStorage.exists(key)
    return res
  } catch {
    return false
  }
}

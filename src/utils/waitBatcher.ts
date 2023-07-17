// Copyright 2019 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import PQueue from 'p-queue'

import { logger as log } from 'utils/logger'
import { sleep } from 'utils/sleep'
import * as Errors from '../types/errors'
import { MINUTE } from './durations'

declare global {
  // We want to extend `window`'s properties, so we need an interface.

  interface Window {
    waitBatchers: Array<BatcherType<any, any>>
    waitForAllWaitBatchers: () => Promise<unknown>
    flushAllWaitBatchers: () => Promise<unknown>
  }
}

window.waitBatchers = []

window.flushAllWaitBatchers = async () => {
  log.info('waitBatcher#flushAllWaitBatchers')
  try {
    await Promise.all(window.waitBatchers.map((item) => item.flushAndWait()))
  } catch (error) {
    log.error('flushAllWaitBatchers: Error flushing all', Errors.toLogFormat(error))
  }
}

window.waitForAllWaitBatchers = async () => {
  log.info('waitBatcher#waitForAllWaitBatchers')
  try {
    await Promise.all(window.waitBatchers.map((item) => item.onIdle()))
  } catch (error) {
    log.error('waitForAllWaitBatchers: Error waiting for all', Errors.toLogFormat(error))
  }
}

type ItemHolderType<ItemType, Return> = {
  resolve?: (value?: Return) => void
  reject?: (error: Error) => void
  item: ItemType
}

type ExplodedPromiseType<Return> = {
  resolve?: (value?: Return) => void
  reject?: (error: Error) => void
  promise: Promise<Return>
}

type BatcherOptionsType<ItemType, Return> = {
  name: string
  wait: number
  maxSize: number
  processBatch: (items: Array<ItemType>) => Promise<Return[]>
}

type BatcherType<ItemType, Return> = {
  add: (item: ItemType) => Promise<Return>
  anyPending: () => boolean
  onIdle: () => Promise<void>
  unregister: () => void
  flushAndWait: () => void
}

export function createWaitBatcher<ItemType, Return>(
  options: BatcherOptionsType<ItemType, Return>
): BatcherType<ItemType, Return> {
  let waitBatcher: BatcherType<ItemType, Return>
  let timeout: NodeJS.Timeout | null
  let items: Array<ItemHolderType<ItemType, Return>> = []
  const queue = new PQueue({
    concurrency: 1,
    timeout: MINUTE * 30,
    throwOnTimeout: true,
  })

  async function _kickBatchOff() {
    const itemsRef = items
    items = []
    await queue.add(async () => {
      try {
        const results = await options.processBatch(itemsRef.map((item) => item.item))
        itemsRef.forEach((item, index) => {
          if (item.resolve) {
            item.resolve(results[index])
          }
        })
      } catch (error: any) {
        itemsRef.forEach((item) => {
          if (item.reject) {
            item.reject(error)
          }
        })
      }
    })
  }

  function _makeExplodedPromise(): ExplodedPromiseType<Return> {
    let resolve
    let reject

    const promise = new Promise<Return>((resolveParam, rejectParam) => {
      resolve = resolveParam
      reject = rejectParam
    })

    return { promise, resolve, reject }
  }

  async function add(item: ItemType): Promise<Return> {
    const { promise, resolve, reject } = _makeExplodedPromise()

    items.push({
      resolve,
      reject,
      item,
    })

    if (items.length === 1) {
      // Set timeout once when we just pushed the first item so that the wait
      // time is bounded by `options.wait` and not extended by further pushes.
      timeout = setTimeout(() => {
        timeout = null
        _kickBatchOff()
      }, options.wait)
    }
    if (items.length >= options.maxSize) {
      if (timeout) clearTimeout(timeout)
      timeout = null

      _kickBatchOff()
    }

    return promise
  }

  function anyPending(): boolean {
    return queue.size > 0 || queue.pending > 0 || items.length > 0
  }

  async function onIdle() {
    while (anyPending()) {
      if (queue.size > 0 || queue.pending > 0) {
        await queue.onIdle()
      }

      if (items.length > 0) {
        await sleep(options.wait * 2)
      }
    }
  }

  function unregister() {
    window.waitBatchers = window.waitBatchers.filter((item) => item !== waitBatcher)
  }

  async function flushAndWait() {
    log.info(`Flushing start ${options.name} for waitBatcher items.length=${items.length}`)
    if (timeout) clearTimeout(timeout)
    timeout = null

    while (anyPending()) {
      await _kickBatchOff()

      if (queue.size > 0 || queue.pending > 0) {
        await queue.onIdle()
      }
    }

    log.info(`Flushing complete ${options.name} for waitBatcher`)
  }

  waitBatcher = {
    add,
    anyPending,
    onIdle,
    unregister,
    flushAndWait,
  }

  window.waitBatchers.push(waitBatcher)

  return waitBatcher
}

// Copyright 2023 Ready.io

/* eslint-disable import/no-unused-modules */

import { explodePromise } from 'utils/explodePromise'
import { logger } from 'utils/logger'
import { toLogFormat } from '../types/errors'
import { MINUTE } from '../utils/durations'

type TaskType = {
  id: string
  startedAt: number | undefined
  suspend(): void
  resume(): void
}

const tasks = new Set<TaskType>()
let shouldStartTimers = true

export function suspendTasksWithTimeout(): void {
  logger.info(`TaskWithTimeout: suspending ${tasks.size} tasks`)
  shouldStartTimers = false
  for (const task of tasks) {
    task.suspend()
  }
}

export function resumeTasksWithTimeout(): void {
  logger.info(`TaskWithTimeout: resuming ${tasks.size} tasks`)
  shouldStartTimers = true
  for (const task of tasks) {
    task.resume()
  }
}

export function reportLongRunningTasks(): void {
  const now = Date.now()
  for (const task of tasks) {
    if (task.startedAt === undefined) {
      continue
    }

    const duration = Math.max(0, now - task.startedAt)
    if (duration > MINUTE) {
      logger.warn(`TaskWithTimeout: ${task.id} has been running for ${duration}ms`)
    }
  }
}

export default function createTaskWithTimeout<T, Args extends Array<unknown>>(
  task: (...args: Args) => Promise<T>,
  id: string,
  options: { timeout?: number } = {}
): (...args: Args) => Promise<T> {
  const timeout = options.timeout || 30 * MINUTE

  const timeoutError = new Error(`${id || ''} task did not complete in time.`)

  return async (...args: Args) => {
    let complete = false

    let timer: NodeJS.Timeout | undefined

    const { promise: timerPromise, reject } = explodePromise<never>()

    const startTimer = () => {
      stopTimer()

      if (complete) {
        return
      }

      entry.startedAt = Date.now()
      timer = setTimeout(() => {
        if (complete) {
          logger.warn(`TaskWithTimeout: ${id} task timed out, but was already complete`)
          return
        }
        complete = true
        tasks.delete(entry)

        logger.error(toLogFormat(timeoutError))
        reject(timeoutError)
      }, timeout)
    }

    const stopTimer = () => {
      if (timer) clearTimeout(timer)
      timer = undefined
    }

    const entry: TaskType = {
      id,
      startedAt: undefined,
      suspend: () => {
        logger.warn(`TaskWithTimeout: ${id} task suspended`)
        stopTimer()
      },
      resume: () => {
        logger.warn(`TaskWithTimeout: ${id} task resumed`)
        startTimer()
      },
    }

    tasks.add(entry)
    if (shouldStartTimers) {
      startTimer()
    }

    let result: unknown

    const run = async (): Promise<void> => {
      result = await task(...args)
    }

    try {
      await Promise.race([run(), timerPromise])

      return result as T
    } finally {
      complete = true
      tasks.delete(entry)
      stopTimer()
    }
  }
}

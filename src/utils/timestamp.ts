// Copyright 2023 Ready.io

import type { Moment } from 'moment'
import moment from 'moment'
import { DAY } from './durations'

type RawTimestamp = Readonly<number | Date | Moment>

export function isMoreRecentThan(timestamp: number, delta: number): boolean {
  return timestamp > Date.now() - delta
}

export function isOlderThan(timestamp: number, delta: number): boolean {
  return timestamp <= Date.now() - delta
}

export function isInPast(timestamp: number): boolean {
  return isOlderThan(timestamp, 0)
}

export function isInFuture(timestamp: number): boolean {
  return isMoreRecentThan(timestamp, 0)
}

export function toDayMillis(timestamp: number): number {
  return timestamp - (timestamp % DAY)
}

export const isSameDay = (a: RawTimestamp, b: RawTimestamp): boolean => moment(a).isSame(b, 'day')

export const isToday = (rawTimestamp: RawTimestamp): boolean => isSameDay(rawTimestamp, Date.now())

const isYesterday = (rawTimestamp: RawTimestamp): boolean =>
  isSameDay(rawTimestamp, moment().subtract(1, 'day'))

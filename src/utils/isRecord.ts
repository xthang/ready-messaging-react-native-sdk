// Copyright 2023 Ready.io

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && !Array.isArray(value)

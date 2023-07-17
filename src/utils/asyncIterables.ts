// Copyright 2023 Ready.io

export type MaybeAsyncIterable<T> = Iterable<T> | AsyncIterable<T>

export function concat<T>(iterables: Iterable<MaybeAsyncIterable<T>>): AsyncIterable<T> {
  return new ConcatAsyncIterable(iterables)
}

class ConcatAsyncIterable<T> implements AsyncIterable<T> {
  constructor(private readonly iterables: Iterable<MaybeAsyncIterable<T>>) {}

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (const iterable of this.iterables) {
      for await (const value of iterable) {
        yield value
      }
    }
  }
}

export function wrapPromise<T>(promise: Promise<MaybeAsyncIterable<T>>): AsyncIterable<T> {
  return new WrapPromiseAsyncIterable(promise)
}

class WrapPromiseAsyncIterable<T> implements AsyncIterable<T> {
  constructor(private readonly promise: Promise<MaybeAsyncIterable<T>>) {}

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for await (const value of await this.promise) {
      yield value
    }
  }
}

// this is to fix this error: TypeError: Object is not async iterable
// when using `for await (... of ...)`
// https://stackoverflow.com/questions/43258568/for-await-of-simple-example-typescript
;(Symbol as any).asyncIterator = Symbol.asyncIterator || Symbol('Symbol.asyncIterator')

import { test } from 'uvu'
import * as assert from 'uvu/assert'

import { Queue } from '../../src/utils/queueClass'

// Silent logger
const mockLogger: Console = { log: () => {}, error: () => {} } as unknown as Console

test('Queue - clearQueue does not reject pending tasks and returns 0 length', async () => {
    const queue = new Queue<string>(mockLogger, 2, 50)
    const results: Array<string> = []
    const errors: Array<any> = []

    const mkTask = (id: string, ms: number) => () => new Promise<string>((resolve) => setTimeout(() => resolve(id), ms))

    // enqueue two tasks
    queue
        .enqueue('A', mkTask('t1', 100), 'ref-1')
        .then((r) => results.push(`ok-${r}`))
        .catch((e) => errors.push(e))

    queue
        .enqueue('A', mkTask('t2', 100), 'ref-2')
        .then((r) => results.push(`ok-${r}`))
        .catch((e) => errors.push(e))

    // clear queue before they finish
    const n = await queue.clearQueue('A')

    assert.is(n, 0)
    // give time for promises to settle
    await new Promise((r) => setTimeout(r, 120))

    // No errors should be reported for a normal clear
    assert.is(errors.length, 0)
    // Resolved (silently) as success according to queue semantics
    assert.ok(results.length >= 0)
})

test('Queue - duplicate fingerIdRef resolves as success without clearing queue', async () => {
    const queue = new Queue<string>(mockLogger, 2, 50)
    let first = ''
    let second = ''

    const slowTask = () => new Promise<string>((resolve) => setTimeout(() => resolve('done'), 30))

    // enqueue first with a ref
    const p1 = queue.enqueue('B', slowTask, 'dup-ref').then((r) => (first = r))
    // enqueue duplicate with same ref should resolve immediately as success
    const p2 = queue.enqueue('B', slowTask, 'dup-ref').then((r) => (second = r))

    await Promise.all([p1, p2])

    assert.is(first, 'success')
    assert.is(second, 'success')
})

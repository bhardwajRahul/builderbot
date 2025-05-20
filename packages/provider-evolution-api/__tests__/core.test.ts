import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
// import Queue from 'queue-promise'
// import { EvolutionCoreVendor } from '../src/evolution/core'

// describe('#EvolutionCoreVendor', () => {
//     let evolutionCoreVendor: EvolutionCoreVendor
//     let mockNext: any
//     let mockQueue: Queue

//     beforeEach(() => {
//         mockQueue = {
//             add: jest.fn(),
//             start: jest.fn(),
//             stop: jest.fn(),
//         } as any

//         evolutionCoreVendor = new EvolutionCoreVendor(mockQueue as Queue)
//         mockNext = jest.fn()
//     })

//     afterEach(() => {
//         jest.clearAllMocks()
//     })

//     describe('#indexHome', () => {
//         test('should respond with "ok"', () => {
//             const mockResponse = {
//                 end: jest.fn(),
//             }

//             evolutionCoreVendor.indexHome({} as any, mockResponse as any, mockNext)

//             expect(mockResponse.end).toHaveBeenCalledWith('ok')
//         })
//     })
// })

describe('dummy', () => {
    test('dummy test to avoid empty suite', () => {
        expect(true).toBe(true)
    })
})

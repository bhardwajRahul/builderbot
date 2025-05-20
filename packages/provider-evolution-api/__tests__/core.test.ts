import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import Queue from 'queue-promise'
import { EvolutionCoreVendor } from '../src/evolution/core'
import { Message } from '../src/types'

jest.mock('../src/utils/processIncomingMsg', () => ({
    processIncomingMessage: jest.fn(),
}))

describe('#EvolutionCoreVendor', () => {
    let evolutionCoreVendor: EvolutionCoreVendor
    let mockNext: any
    let mockQueue: Queue

    beforeEach(() => {
        mockQueue = {
            add: jest.fn(),
            start: jest.fn(),
            stop: jest.fn(),
        } as any

        evolutionCoreVendor = new EvolutionCoreVendor(mockQueue as Queue)
        mockNext = jest.fn()
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    describe('#indexHome', () => {
        test('should respond with "ok"', () => {
            // Arrange
            const mockResponse = {
                end: jest.fn(),
            }
            // Act
            evolutionCoreVendor.indexHome(null as any, mockResponse as any, mockNext)

            // Assert
            expect(mockResponse.end).toHaveBeenCalledWith('ok')
        })
    })
})

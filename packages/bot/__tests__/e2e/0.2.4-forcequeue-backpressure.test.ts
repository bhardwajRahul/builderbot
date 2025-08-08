import { suite } from 'uvu'
import * as assert from 'uvu/assert'

import { setup, clear, parseAnswers } from '../../__mock__/env'
import { addKeyword, createBot, createFlow, EVENTS } from '../../src'
import { delay } from '../../src/utils'

const suiteCase = suite('Flujo: forceQueue backpressure & re-queue')

suiteCase.before.each(setup)
suiteCase.after.each(clear)

suiteCase('Backpressure multi-usuario con forceQueue (WELCOME)', async ({ database, provider }) => {
    const flowWelcome = addKeyword(EVENTS.WELCOME).addAnswer('Welcome!')

    const bot = await createBot({ database, provider, flow: createFlow([flowWelcome]) })

    const users = Array.from({ length: 12 }).map((_, i) => `${1000 + i}`)

    // Mensajes que no coinciden con palabras clave definidas -> caen en WELCOME con forceQueue
    await Promise.all(
        users.map((u) => provider.delaySendMessage(0, 'message', { from: u, body: 'algo-que-no-coincide' }))
    )

    // Dar tiempo a procesar la cola
    await delay(500)

    const answers = parseAnswers(database.listHistory).filter((a) => a.answer === 'Welcome!')
    assert.is(answers.length, users.length)

    // Verificar que idsCallbacks se vacían por usuario
    for (const u of users) {
        assert.equal(bot.queuePrincipal.getIdsCallback(u), [])
    }
})

suiteCase('Re-queue en ráfagas para un mismo usuario (WELCOME)', async ({ database, provider }) => {
    const flowWelcome = addKeyword(EVENTS.WELCOME).addAnswer('Bienvenido!')

    const bot = await createBot({ database, provider, flow: createFlow([flowWelcome]) })

    const from = '999'
    const bursts = 10

    for (let i = 0; i < bursts; i++) {
        // Mensaje que forzará WELCOME/forceQueue cada vez
        await provider.delaySendMessage(0, 'message', { from, body: `ping-${i}` })
    }

    await delay(800)

    const answers = parseAnswers(database.listHistory).filter((a) => a.from === from && a.answer === 'Bienvenido!')
    // Debe haber como mínimo una respuesta por ráfaga
    assert.is(answers.length, bursts)

    // Sin pendientes en idsCallbacks
    assert.equal(bot.queuePrincipal.getIdsCallback(from), [])
})

suiteCase.run()

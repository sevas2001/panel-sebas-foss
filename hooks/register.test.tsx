import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { cambiosDeModelo, medidas, proyeccion5h, ritmo5h, svgBanda, svgDetalleLinea } from './graficos'
import { leerPreparacionCompact, leerVentana, nivelContexto, umbralesCompactar } from './util'
import { agrupar, consejoModelo, costeBaseTurno, costeCambio, leerConsejo, markdown, nombreModelo, svgCompacta } from './util'

const BANDA = {
  plugin: 'sevas-panel',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 3,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 3 },
    view: {},
  },
} as const

const AHORA = new Date(2026, 10, 10, 12, 0, 0).getTime()

const USO = {
  startedAt: 0,
  context: { tokens: 340_000, window: 1_000_000, percent: 34 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 18 }],
  cost: { usd: 0.4249 },
}

test('nombre legible del modelo', async () => {
  expect(nombreModelo('claude-opus-5-5')).toBe('Opus 5.5')
  expect(nombreModelo('claude-fable-5-2[1m]')).toBe('Fable 5.2')
  expect(nombreModelo('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(nombreModelo('sonnet')).toBe('Sonnet')
})

test('consejo de modelo', async () => {
  expect(consejoModelo('claude-sonnet-5-5', 'Migra el módulo de pagos a TypeScript')).toBe('subir')
  expect(consejoModelo('claude-haiku-5-5', 'refactoriza el servicio de usuarios')).toBe('subir')
  expect(consejoModelo('claude-fable-5-2', 'arregla el typo del README')).toBe('bajar')
  expect(consejoModelo('claude-fable-5-2', 'Diseña la arquitectura del nuevo módulo')).toBe(null)
  expect(consejoModelo('claude-opus-5-5', 'arregla el typo')).toBe(null)
})

test('agrupar suma por clave y ordena de mayor a menor', async () => {
  const s = (id: string, modelo: string, usd: number) => ({
    id,
    dia: '2026-11-10',
    proyecto: 'p',
    modelo,
    usd,
    ultima: 0,
  })
  expect(agrupar([s('a', 'Opus 5.5', 1), s('b', 'Fable 5.2', 3), s('c', 'Opus 5.5', 1.5)], (x: { modelo: string }) => x.modelo)).toEqual([
    ['Fable 5.2', 3],
    ['Opus 5.5', 2.5],
  ])
})

test('la banda muestra modelo, contexto, coste y límite en cada superficie', async ($, on) => {
  on('command.register', () => ({ value: { command: 'gasto' } }))
  on('session.usage', () => ({ value: USO }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BANDA, surface })
    if (surface === 'desktop') {
      const alt = String((await ui.find({ type: 'Svg' }))?.props?.alt)
      expect(alt).toBe('Opus 5.5 · ctx 34 % · $0.42 · 5 h 18 %')
      expect(await ui.find({ type: 'Button', key: 'recomendar' })).toBeTruthy()
      await ui.unmount()
      continue
    }
    expect((await ui.find({ type: 'Text', text: /Opus 5\.5/ }))?.text).toContain('Opus 5.5')
    expect((await ui.find({ type: 'Text', text: /ctx/ }))?.text).toBe('ctx 34 %')
    expect((await ui.find({ type: 'Text', text: /^\$/ }))?.text).toBe('$0.42')
    expect((await ui.find({ type: 'Text', text: /^5 h/ }))?.text).toBe('5 h 18 %')
    expect(await ui.find({ type: 'Button', key: 'detalle' })).toBeTruthy()
    await ui.unmount()
  }
})

const preparar = (on: TestBody extends ($: never, on: infer O) => unknown ? O : never, usd = { v: 0.4249 }, ctx = USO.context) => {
  on('command.register', () => ({ value: { command: 'gasto' } }))
  on('session.usage', () => ({ value: { ...USO, context: ctx, cost: { usd: usd.v } } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sesion-1' }))
  on('session.cwd', () => ({ value: 'C:/proyectos/Q-human' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('clock.now', () => ({ value: AHORA }))
}

test('el modo detalle dibuja columnas en la terminal y un SVG en escritorio', async ($, on) => {
  const usd = { v: 0.1 }
  preparar(on, usd)
  on('tool.call', () => ({ result: {}, text: 'Tests: 1 failed, 199 passed, 200 total', isError: true }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  const uso = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 9000, cache_creation_input_tokens: 900 }
  await $.turn.complete({ answer: '', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer', usage: { ...uso, model: 'claude-opus-5-5' } })
  usd.v = 0.4249
  await $.turn.complete({ answer: '', durationMs: 6000, isAborted: false, turnId: 't2', reason: 'answer', usage: { ...uso, model: 'claude-opus-5-5' } })

  const compacta = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect((await compacta.find({ type: 'Text', text: /^último/ }))?.text).toBe('último $0.32')
  expect((await compacta.find({ type: 'Text', text: /^caché/ }))?.text).toBe('caché 90 %')
  expect((await compacta.find({ type: 'Text', text: /fallan/ }))?.text).toBe('✗ 1 fallan')
  await compacta.press({ key: 'detalle' })
  await compacta.unmount()

  const terminal = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect((await terminal.find({ type: 'Text', text: /^tiempo de Claude$/ }))?.text).toBe('tiempo de Claude')
  expect((await terminal.find({ type: 'Text', text: /⌀ 5 s \/ turno/ }))?.text).toBe('⌀ 5 s / turno')
  expect((await terminal.find({ type: 'Text', text: /último \$0\.32 · ⌀ \$0\.21/ }))?.text).toBe('último $0.32 · ⌀ $0.21')
  await terminal.unmount()

  const escritorio = await $.ui.mount({ ...BANDA, surface: 'desktop' })
  const svg = await escritorio.find({ type: 'Svg' })
  expect(String(svg?.props?.alt)).toContain('coste $0.42')
  expect(String(svg?.props?.alt)).toContain('tests 1 fallan')
  await escritorio.unmount()
})

test('editar código después de los tests los marca como pendientes', async ($, on) => {
  preparar(on)
  on('tool.call', (_, e) =>
    e.tool === 'Bash' ? { result: {}, text: '12 passed' } : { result: {} },
  )
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'pytest' })
  let ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /pasan/ }))?.text).toBe('✓ 12 pasan')
  await ui.unmount()

  await $.tool.call({ tool: 'Edit', file_path: 'C:/p/app.py', old_string: 'a', new_string: 'b' })
  ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /sin tests/ }))?.text).toBe('sin tests desde el último cambio')
  await ui.unmount()
})

test('el resumen en Markdown lleva coste, tokens y caché', async () => {
  const md = markdown(
    { modelo: 'claude-opus-5-5', esfuerzo: 'medium', ctx: 34, ctxTokens: 340_000, ventana: 1_000_000, usd: 0.42, limite5h: 18, resets5h: null },
    {
      nombre: 'Migrar pagos',
      turnos: 2,
      base: 0.42,
      costesTurno: [0.1, 0.32],
      ms: 10_000,
      tokens: { entrada: 200, salida: 100, cacheLee: 18_000, cacheEscribe: 1_800 },
      tests: { estado: 'falla', fallan: 1 },
      historial: [],
    },
    'Q-human',
    AHORA,
  )
  expect(md).toContain('## Migrar pagos')
  expect(md).toContain('| Modelo | Opus 5.5 · esfuerzo medium |')
  expect(md).toContain('último turno $0.32')
  expect(md).toContain('| Caché | 90 % de la entrada |')
  expect(md).toContain('| Tests | ✗ 1 fallan |')
})



test('el panel suma el gasto de hoy y de la semana', async ($, on) => {
  const sesiones = [
    { id: 'a', dia: '2026-11-10', proyecto: 'Q-human', modelo: 'Opus 5.5', usd: 1.25, ultima: AHORA - 1000 },
    { id: 'b', dia: '2026-11-10', proyecto: 'mio', modelo: 'Fable 5.2', usd: 2.5, ultima: AHORA - 500 },
    { id: 'c', dia: '2026-11-08', proyecto: 'Q-human', modelo: 'Sonnet 5.5', usd: 0.5, ultima: AHORA - 2 * 86_400_000 },
    { id: 'd', dia: '2026-10-01', proyecto: 'viejo', modelo: 'Opus 5.5', usd: 9, ultima: 1 },
  ]
  on('command.register', () => ({ value: { command: 'gasto' } }))
  on('session.usage', () => ({ value: USO }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('store.get', () => ({ value: sesiones }))
  on('clock.now', () => ({ value: AHORA }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const panel = (surface: 'desktop' | 'terminal') =>
    $.ui.mount({
      plugin: 'sevas-panel',
      component: 'Pane',
      requestId: 'sevas-gasto',
      surface,
      props: {
        title: 'Gasto de Claude',
        isFocused: false,
        bodyColumns: 60,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 40 },
        view: {},
      },
    })
  // En la terminal, la lista de texto.
  let ui = await panel('terminal')
  expect((await ui.find({ type: 'Text', text: /^Hoy/ }))?.text).toBe('Hoy: $3.75 · 2 sesiones')
  expect((await ui.find({ type: 'Text', text: /^Últimos 7/ }))?.text).toBe('Últimos 7 días: $4.25 · 3 sesiones')
  expect((await ui.find({ type: 'Text', text: /Fable 5\.2$/ }))?.text).toContain('$2.50')
  await ui.unmount()

  // En escritorio, el diseño en un SVG con tamaño propio y el selector de periodo.
  ui = await panel('desktop')
  let svg = String((await ui.find({ type: 'Svg' }))?.props?.source)
  expect(svg).toContain('$3.75')
  expect(svg).toContain('$4.25')
  expect(svg).toContain('Fable 5.2')
  expect(svg).toContain('Últimas sesiones')
  expect(svg).not.toContain('viejo')
  expect((await ui.find({ type: 'Svg' }))?.props?.width).toBe(436)
  await ui.press({ key: 'rango-30' })
  await ui.unmount()
  ui = await panel('desktop')
  svg = String((await ui.find({ type: 'Svg' }))?.props?.source)
  expect(svg).toContain('Últimos 30 días')
  await ui.unmount()
})

test('la fila de tests filtrados lleva la marca de ahorro', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>fila del motor</Text>
  })
  const salida = [
    '[tests FALLAN (código 1). Salida de 208 líneas filtrada; completa en: /tmp/x.log]',
    '--- fallos ---',
    '125:FAIL src/suma.test.js',
    '--- resumen final ---',
    'Tests: 1 failed, 199 passed, 200 total',
  ].join('\n')
  const ui = await $.ui.mount({
    plugin: 'sevas-panel',
    component: 'ToolUse',
    surface: 'desktop',
    props: {
      tool_use_id: 't1',
      tool: 'Bash',
      input: { command: 'bash "/p/hooks/filtrar-tests.sh" npm test' },
      isRunning: false,
      isErrored: true,
      isInterrupted: false,
      output: salida,
    },
  })
  expect((await ui.find({ type: 'Text', text: /fila del motor/ }))?.text).toBe('fila del motor')
  expect((await ui.find({ type: 'Text', text: /filtrada:/ }))?.text).toBe('Salida de tests filtrada: 208 → 5 líneas')
  await ui.unmount()
})

test('leer la recomendación y calcular el coste de cambiar', async () => {
  expect(leerConsejo('sonnet|medium|Bug acotado con spec clara.')).toEqual({
    modelo: 'sonnet',
    esfuerzo: 'medium',
    motivo: 'Bug acotado con spec clara',
  })
  expect(leerConsejo('Claro: Fable | high | migración grande')?.modelo).toBe('fable')
  expect(leerConsejo('no sé')).toBe(null)
  // 340k de contexto: releerlo en Opus cuesta $0.07 por turno; pasarlo a Sonnet, $0.85 una vez.
  expect(costeBaseTurno('claude-opus-5-5', 340_000).toFixed(2)).toBe('0.07')
  expect(costeCambio('sonnet', 340_000).toFixed(2)).toBe('0.85')
})

test('la banda compacta de escritorio es una sola imagen con los colores del tema', async () => {
  const svg = svgCompacta([{ texto: 'Opus 5.5', clase: 'cb' }, { texto: 'ctx 34 %', clase: 'success' }, { texto: '$0.42' }])
  expect(svg).toContain('>Opus 5.5</tspan>')
  expect(svg).toContain('#ffc94d')
  expect(svg).toContain('#6ee7ff')
  expect(svgCompacta([{ texto: 'x' }], 'neutro')).not.toContain('#ffc94d')
})

test('Recomendar consulta a Haiku, muestra el consejo y Aplicar cambia modelo y esfuerzo', async ($, on) => {
  preparar(on)
  const ejecutados: string[] = []
  let pedido = ''
  on('prompt.read', () => ({ value: { text: 'arregla el bug del login', cursor: 0 } }))
  on('ui.toast', () => ({ value: undefined }))
  on('model.complete', (_, e) => {
    pedido = JSON.stringify(e)
    return {
      value: {
        isAnswered: true,
        text: 'sonnet|medium|bug acotado',
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })
  on('command.run', (_, e) => {
    ejecutados.push(`${e.command} ${e.args}`.trim())
    return {}
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  let ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  await ui.press({ key: 'recomendar' })
  await ui.unmount()
  expect(pedido).toContain('"model":"haiku"')
  expect(pedido).toContain('arregla el bug del login')

  ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Recomendado/ }))?.text).toBe(
    'Recomendado: Sonnet 5.5 (elígelo en el selector de la app) · medium — bug acotado · cambiar ahora reescribe la caché: ≈$0.85',
  )
  await ui.press({ key: 'aplicar' })
  await ui.unmount()
  expect(ejecutados).toEqual(['effort medium'])

  ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^Recomendado/ })).toBeFalsy()
  await ui.unmount()
})

test('los gráficos marcan cambios de modelo, compactaciones y el ritmo del límite', async () => {
  const fila = (ctx: number, coste: number, cache: number, modelo: string, compactado = false) => ({
    ctx,
    coste,
    cache,
    modelo,
    ...(compactado ? { compactado: true } : {}),
  })
  const historial = [
    fila(8, 0.4, 92, 'claude-opus-5-5'),
    fila(12, 0.6, 94, 'claude-opus-5-5'),
    fila(19, 0.9, 93, 'claude-fable-5-2'),
    fila(38, 1.6, 41, 'claude-fable-5-2'),
    fila(14, 2.9, 60, 'claude-opus-5-5', true),
    fila(22, 0.6, 93, 'claude-sonnet-5-5'),
  ]
  expect(cambiosDeModelo(historial)).toEqual([2, 4, 5])
  const m = {
    nombre: '', turnos: 6, base: 7, costesTurno: [0.4, 0.6, 0.9, 1.6, 2.9, 0.6], ms: 60_000,
    tokens: { entrada: 0, salida: 0, cacheLee: 0, cacheEscribe: 0 }, tests: { estado: 'ninguno' as const }, historial,
  }
  const ahora = Date.UTC(2026, 10, 10, 15, 40)
  const reset = ahora + 3 * 3_600_000
  const info = { modelo: 'claude-opus-5-5', esfuerzo: 'medium', ctx: 22, ctxTokens: 220_000, ventana: 1_000_000, usd: 7, limite5h: 20, resets5h: reset }
  const linea = svgDetalleLinea(info, m, ahora)
  expect(linea).toContain('→ Fable')
  expect(linea).toContain('/compact')
  expect(linea).toContain('$2.90')
  expect(linea).toContain('turno 6')
  expect(linea).toContain('width="740"')
  expect(linea).toContain('>Sesión</text>')
  expect(linea).toContain('>$7.00</text>')
  expect(linea).toContain('≈50 % al renovarse')
  // Ninguna barra se sale del área del gráfico (62 a 520).
  for (const mm of linea.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"[^>]*class="cos"/g)) {
    expect(Number(mm[1])).toBeGreaterThanOrEqual(62)
    expect(Number(mm[1]) + Number(mm[2])).toBeLessThanOrEqual(520)
  }
  expect(Math.round(ritmo5h(reset, ahora) ?? -1)).toBe(40)
  expect(proyeccion5h(20, 40, reset)).toContain('≈50 %')
  const banda = svgBanda(info, m, ahora)
  expect(banda).toContain('Opus 5.5')
  expect(banda).toContain('20 %')
  expect(banda).toContain('+$0.60')
})

test('cada gráfico declara su tamaño para que la app no lo estire', async () => {
  expect(medidas('<svg xmlns="x" width="150" height="84" viewBox="0 0 100 56"></svg>')).toEqual({ width: 150, height: 84 })
})

test('Mejorar reescribe el borrador con la guía del modelo y Deshacer lo recupera', async ($, on) => {
  preparar(on)
  let caja = 'haz un script que borre logs viejos'
  let pedido = ''
  on('prompt.read', () => ({ value: { text: caja, cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    caja = e.text
    return { isFilled: true }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('model.complete', (_, e) => {
    pedido = JSON.stringify(e)
    return {
      value: {
        isAnswered: true,
        text: 'Escribe un script que borre los logs de más de 30 días y compruébalo.',
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  let ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  await ui.press({ key: 'mejorar' })
  await ui.unmount()
  expect(caja).toBe('Escribe un script que borre los logs de más de 30 días y compruébalo.')
  expect(pedido).toContain('haz un script que borre logs viejos')

  ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  await ui.press({ key: 'deshacer' })
  await ui.unmount()
  expect(caja).toBe('haz un script que borre logs viejos')
})

test('Mejorar+ usa la conversación de la sesión y separa la nota de lo tomado del chat', async ($, on) => {
  preparar(on)
  let caja = 'arregla lo de la tabla de antes'
  let pedido = ''
  const avisos: string[] = []
  on('prompt.read', () => ({ value: { text: caja, cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    caja = e.text
    return { isFilled: true }
  })
  on('ui.toast', (_, e) => {
    avisos.push(String((e as { text?: unknown }).text ?? ''))
    return { value: undefined }
  })
  on('model.fork', (_, e) => {
    pedido = JSON.stringify(e)
    return {
      value: {
        isAnswered: true,
        text: 'Arregla el filtro de fechas de la tabla usuarios_activos sin tocar la API.\n===CHAT===\nla tabla usuarios_activos y que no se toca la API',
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  let ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  await ui.press({ key: 'mejorar-plus' })
  await ui.unmount()
  expect(caja).toBe('Arregla el filtro de fechas de la tabla usuarios_activos sin tocar la API.')
  expect(pedido).toContain('arregla lo de la tabla de antes')
  expect(pedido).not.toContain('"effort"')
  expect(avisos.some(a => a.includes('Del chat: la tabla usuarios_activos'))).toBe(true)

  ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  await ui.press({ key: 'deshacer' })
  await ui.unmount()
  expect(caja).toBe('arregla lo de la tabla de antes')
})

test('umbrales de compactación en tres niveles, con el valor de autoCompactWindow si existe', async () => {
  const u = umbralesCompactar(967_000)
  expect(u).toEqual({ suave: 200_000, claro: 500_000, urgente: 867_000, auto: 967_000 })
  expect(nivelContexto(150_000, u)).toBe(0)
  expect(nivelContexto(200_000, u)).toBe(1)
  expect(nivelContexto(520_000, u)).toBe(2)
  expect(nivelContexto(900_000, u)).toBe(3)
  // Con /autocompact a 500K, el aviso de 500K sobra: el urgente llega antes.
  const corto = umbralesCompactar(500_000)
  expect(corto).toEqual({ suave: 200_000, claro: null, urgente: 400_000, auto: 500_000 })
  expect(nivelContexto(450_000, corto)).toBe(3)
  expect(leerVentana(200000)).toBe(200_000)
  expect(leerVentana('500k')).toBe(500_000)
  expect(leerVentana('1M')).toBe(1_000_000)
  expect(leerVentana('200')).toBe(null)
  expect(leerVentana(undefined)).toBe(null)
})

test('Compactar… deja un /compact con instrucciones en el cuadro de texto, sin enviarlo', async ($, on) => {
  preparar(on)
  let caja = ''
  let enviado = false
  const avisos: string[] = []
  on('prompt.read', () => ({ value: { text: caja, cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    caja = e.text
    return { isFilled: true }
  })
  on('command.run', () => {
    enviado = true
    return {}
  })
  on('ui.toast', (_, e) => {
    avisos.push(String((e as { text?: unknown }).text ?? ''))
    return { value: undefined }
  })
  on('model.fork', () => ({
    value: {
      isAnswered: true,
      text: 'Conserva: la banda del mod sevas-panel, los umbrales 200K/500K/867K y que no se toca la vista compacta.\n===AVISO===\nhay una tarea a medias: faltan los tests',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // Con 340K (por encima de 200K y por debajo de 500K) sale en la compacta, sin resaltar.
  let ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  const boton = await ui.find({ type: 'Button', key: 'compactar' })
  expect(boton?.props?.plain).toBe(true)
  expect(boton?.props?.variant).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'detalle' }))?.props?.label).toBe('↖↘')
  await ui.press({ key: 'detalle' })
  await ui.unmount()
  ui = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect((await ui.find({ type: 'Button', key: 'detalle' }))?.props?.label).toBe('↘↖')
  await ui.press({ key: 'compactar' })
  await ui.unmount()
  expect(caja).toBe('/compact Conserva: la banda del mod sevas-panel, los umbrales 200K/500K/867K y que no se toca la vista compacta.')
  expect(enviado).toBe(false)
  expect(avisos.some(a => a.includes('sin enviar') && a.includes('tarea a medias'))).toBe(true)
  expect(leerPreparacionCompact('/compact Conserva: x\n===AVISO===\nnada')).toEqual({ instrucciones: 'Conserva: x', aviso: '' })
})

test('desde el 50 % el botón Compactar… sale en un recuadro rojo con ⚠', async ($, on) => {
  preparar(on, undefined, { tokens: 600_000, window: 1_000_000, percent: 60 })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BANDA, surface: 'desktop' })
  const caja = await ui.find({ type: 'Box', key: 'compactar-alerta' })
  expect(caja?.props?.borderColor).toBe('error')
  expect(caja?.props?.backgroundColor).toBe('error')
  const boton = await ui.find({ type: 'Button', key: 'compactar' })
  expect(boton?.props?.variant).toBe('primary')
  expect(boton?.props?.plain).toBeUndefined()
  await ui.unmount()

  const ut = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await ut.find({ type: 'Text', text: '⚠ Compactar…' })).toBeTruthy()
  await ut.unmount()
})

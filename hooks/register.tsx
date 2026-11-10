import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Consejo, Info, Metricas, Sesion, Tema, Turno } from '../types'
import { medidas, svgBanda, svgDetalleLinea } from './graficos'
import { delRango, type Rango, svgPanel } from './panel'
import { type Familia, leerMejoraConChat, pedidoMejorarConChat, sistemaMejorar } from './guias'
import {
  AUTOCOMPACT_POR_DEFECTO,
  DIA_MS,
  ID_MODELO,
  leerPreparacionCompact,
  leerVentana,
  nivelContexto,
  PEDIDO_COMPACTAR,
  textoAvisoContexto,
  umbralesCompactar,
  SISTEMA_RECOMENDAR,
  METRICAS_VACIAS,
  agrupar,
  base,
  coloresTema,
  costeCambio,
  familia,
  leerConsejo,
  svgCompacta,
  textoConsejo,
  trozos,
  columnas,
  consejoModelo,
  contarTests,
  dia,
  dinero,
  esCodigo,
  esComandoTests,
  markdown,
  nombreModelo,
  pctCache,
  sumar,
  sumarTokens,
  svgDetalle,
  textoTests,
  tiempo,
} from './util'

// sevas-panel: todo lo que hace este mod lo ve la persona, no el modelo, así que no
// gasta tokens. Lee las cifras que Claude Code ya tiene (las de la barra de estado).

const PANEL = 'sevas-gasto'

const info = atom({ plugin: 'sevas-panel', key: 'info' } as const, null)
const metricas = atom({ plugin: 'sevas-panel', key: 'metricas' } as const, METRICAS_VACIAS, {
  shape: 'metricas-3',
})
const sesiones = atom({ plugin: 'sevas-panel', key: 'sesiones' } as const, [], {
  shape: 'sesiones-2',
})
const oculta = atom({ plugin: 'sevas-panel', key: 'oculta' } as const, false)
const detalle = atom({ plugin: 'sevas-panel', key: 'detalle' } as const, false)
const consejo = atom({ plugin: 'sevas-panel', key: 'consejo' } as const, null)
const tema = atom({ plugin: 'sevas-panel', key: 'tema' } as const, 'ironman')
// El borrador tal como estaba antes de pulsar Mejorar, para poder deshacerlo.
const previo = atom({ plugin: 'sevas-panel', key: 'previo' } as const, null)
const rango = atom({ plugin: 'sevas-panel', key: 'rango' } as const, '7')

// ---------- estado del módulo (se reinicia al recargar el mod) ----------

let esfuerzo: string | null = null
// Último aviso de compactación dado (0 a 3) y dónde salta la autocompactación.
let avisadoNivel = 0
let autoCompact = AUTOCOMPACT_POR_DEFECTO
const dicho = { subir: false, bajar: false }
let ultimoPrompt = ''
let compactado = false

// ---------- lecturas y registro ----------

const refrescar = async ($: EngineInterface): Promise<Info> => {
  const uso = await $.session.usage().catch(() => undefined)
  const modelo = await $.session.model().catch(() => '')
  const limite = uso?.rateLimits.find(r => r.kind === 'five_hour')
  const valor: Info = {
    modelo,
    esfuerzo,
    ctx: uso?.context.percent ?? null,
    ctxTokens: uso?.context.tokens ?? null,
    ventana: uso?.context.window ?? null,
    usd: uso?.cost?.usd ?? null,
    limite5h: limite ? limite.percentUsed : null,
    resets5h: limite?.resetsAt ? Date.parse(limite.resetsAt) || null : null,
  }
  await update($, info, () => valor)
  return valor
}

const registrar = async ($: EngineInterface, valor: Info, nombre: string) => {
  if (valor.usd === null) return
  const id = await $.session.id()
  const ahora = await $.clock.now()
  const proyecto = base(await $.session.cwd().catch(() => ''))
  const guardadas = ((await $.store.get('sesiones')) as Sesion[] | undefined) ?? []
  const previa = guardadas.find(s => s.id === id)
  const fila: Sesion = {
    id,
    dia: previa?.dia ?? dia(ahora),
    proyecto,
    modelo: nombreModelo(valor.modelo),
    usd: valor.usd,
    ultima: ahora,
    nombre: nombre || previa?.nombre,
  }
  const lista = [...guardadas.filter(s => s.id !== id), fila]
    .sort((a, b) => a.ultima - b.ultima)
    .slice(-500)
  await $.store.set('sesiones', lista)
  await update($, sesiones, () => lista)
}

// ---------- avisos ----------

// La variable de entorno manda sobre el ajuste, como en Claude Code. Lo guardado con /autocompact
// no se puede leer desde un mod: en ese caso se usa el valor por defecto.
const leerAutoCompact = async ($: EngineInterface) => {
  const delEntorno = leerVentana(await $.env.get('CLAUDE_CODE_AUTO_COMPACT_WINDOW').catch(() => undefined))
  const delAjuste = leerVentana(await $.settings.read({ key: 'autoCompactWindow' }).catch(() => undefined))
  autoCompact = delEntorno ?? delAjuste ?? AUTOCOMPACT_POR_DEFECTO
}

// Avisos de compactación en tres niveles; cada uno sale una vez y se rearma si el contexto baja.
const avisarContexto = ($: EngineInterface, tokens: number | null) => {
  if (tokens === null) return
  const u = umbralesCompactar(autoCompact)
  const nivel = nivelContexto(tokens, u)
  if (nivel < avisadoNivel) avisadoNivel = nivel
  if (nivel === 0 || nivel <= avisadoNivel) return
  avisadoNivel = nivel
  $.ui.toast(textoAvisoContexto(nivel, tokens, u), { timeoutMs: nivel === 3 ? 14_000 : 9_000 })
}

// Prepara un /compact con instrucciones de qué conservar y lo deja en el cuadro de texto, sin enviarlo.
const prepararCompact = async ($: EngineInterface) => {
  $.ui.toast('Preparando el /compact con lo que conviene conservar…', { timeoutMs: 4_000 })
  // Sin effort: así se reutiliza la caché de la conversación.
  const r = await $.model.fork({ prompt: PEDIDO_COMPACTAR })
  if (!r.isAnswered) {
    $.ui.toast(
      r.reason === 'nothing-to-fork'
        ? 'Aún no hay conversación que compactar.'
        : 'No se pudieron preparar las instrucciones. Puedes escribir /compact a mano.',
    )
    return
  }
  const { instrucciones, aviso } = leerPreparacionCompact(r.text)
  const texto = instrucciones ? `/compact ${instrucciones}` : '/compact '
  const caja = await $.prompt.read().catch(() => undefined)
  const hecho = await $.prompt.fill({ text: texto, mode: 'replace' }).catch(() => undefined)
  if (hecho?.isFilled) {
    if (caja?.text.trim()) await update($, previo, () => caja.text)
    $.ui.toast(
      `/compact preparado en el cuadro de texto, sin enviar: revísalo y pulsa Enter.${aviso ? ` Ojo: ${aviso}` : ''}`,
      { timeoutMs: 12_000 },
    )
    return
  }
  const copiado = await $.ui.copy({ text: texto }).catch(() => undefined)
  $.ui.toast(copiado ? 'No se pudo escribir en el cuadro de texto: el /compact preparado está en el portapapeles.' : 'No se pudo escribir el /compact en el cuadro de texto.')
}

const aconsejar = async ($: EngineInterface, texto: string) => {
  const modelo = await $.session.model()
  const consejo = consejoModelo(modelo, texto)
  if (consejo === 'subir' && !dicho.subir) {
    dicho.subir = true
    $.ui.toast(
      `Tarea grande en ${nombreModelo(modelo)}: para esto se recomienda Opus 5.5 (Fable 5.2 si es una migración o un rediseño mayor). Cámbialo con /model.`,
      { timeoutMs: 10_000 },
    )
  } else if (consejo === 'bajar' && !dicho.bajar) {
    dicho.bajar = true
    $.ui.toast(
      'Petición corta en Fable 5.2: Opus 5.5 la resuelve igual a mitad de precio por token. Cámbialo con /model si quieres.',
      { timeoutMs: 10_000 },
    )
  }
}

// ---------- acciones de los botones ----------

const abrirPanel = ($: EngineInterface) => $.ui.open({ id: PANEL, title: 'Gasto de Claude' })

const copiar = async ($: EngineInterface, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']) => {
  const v = (await read($, info)) ?? (await refrescar($))
  const m = await read($, metricas)
  const uso = await $.session.usage().catch(() => undefined)
  const proyecto = base(await $.session.cwd().catch(() => ''))
  const inicio = uso?.startedAt ?? (await $.clock.now())
  const hecho = await $.ui.copy({ text: markdown(v, m, proyecto, inicio), surface })
  $.ui.toast(hecho.isCopied ? 'Resumen de la sesión copiado en Markdown' : `No se pudo copiar: ${hecho.reason}`)
}

const alternarDetalle = async ($: EngineInterface) => {
  const ahora = !(await read($, detalle))
  await update($, detalle, () => ahora)
  await $.store.set('detalle', ahora)
}

// Recomendar: una consulta corta a Haiku con la tabla de la skill elegir-modelo.
// Es lo único del mod que gasta tokens (unos 500 de Haiku, una fracción de céntimo), y solo al pulsar.
const recomendar = async ($: EngineInterface) => {
  const caja = await $.prompt.read().catch(() => undefined)
  const tarea = caja?.text.trim() || ultimoPrompt || (await read($, metricas)).nombre
  if (!tarea) {
    $.ui.toast('Escribe la tarea en el cuadro de texto y pulsa Recomendar antes de enviarla.')
    return
  }
  $.ui.toast('Consultando qué modelo y esfuerzo encajan…', { timeoutMs: 3_000 })
  const v = (await read($, info)) ?? (await refrescar($))
  const r = await $.model.complete({
    model: 'haiku',
    system: SISTEMA_RECOMENDAR,
    prompt: `Tarea:\n${tarea.slice(0, 2000)}`,
    maxTokens: 200,
    effort: 'low',
    timeoutMs: 30_000,
  })
  const leido = r.isAnswered ? leerConsejo(r.text) : null
  if (!leido) {
    $.ui.toast('No se pudo obtener una recomendación. Prueba de nuevo o usa la skill elegir-modelo.')
    return
  }
  const mismoModelo = familia(v.modelo) === leido.modelo
  const valor: Consejo = {
    ...leido,
    igual: mismoModelo && (v.esfuerzo === null || v.esfuerzo === leido.esfuerzo),
    mismoModelo,
    costeCambio: mismoModelo || v.ctxTokens === null ? null : costeCambio(leido.modelo, v.ctxTokens),
  }
  await update($, consejo, () => valor)
}

const NOMBRE_FAMILIA: Record<Familia, string> = {
  haiku: 'Haiku 5.5',
  sonnet: 'Sonnet 5.5',
  opus: 'Opus 5.5',
  fable: 'Fable 5.2',
}

// Reescribe el borrador del cuadro de texto con la guía de prompting del modelo de la sesión.
// Reescribe el borrador. Sin chat: Sonnet en bajo con solo el borrador.
// Con chat (Mejorar+): una consulta aparte sobre la conversación de la sesión, servida desde su caché.
const mejorar = async ($: EngineInterface, conChat = false) => {
  const caja = await $.prompt.read().catch(() => undefined)
  const texto = caja?.text ?? ''
  const boton = conChat ? 'Mejorar+' : 'Mejorar'
  if (!texto.trim()) {
    $.ui.toast(`Escribe primero el prompt en el cuadro de texto y luego pulsa ${boton}.`)
    return
  }
  const f = familia(await $.session.model().catch(() => ''))
  const fam: Familia = f === 'mythos' ? 'fable' : f === 'haiku' || f === 'opus' || f === 'fable' ? f : 'sonnet'
  const fecha = new Date(await $.clock.now()).toISOString().slice(0, 10)
  const borrador = texto.slice(0, 12_000)
  $.ui.toast(
    conChat
      ? `Mejorando el prompt con lo hablado en el chat y la guía de ${NOMBRE_FAMILIA[fam]}…`
      : `Mejorando el prompt con la guía de ${NOMBRE_FAMILIA[fam]}…`,
    { timeoutMs: 4_000 },
  )
  let nuevo = ''
  let nota = ''
  if (conChat) {
    // Sin effort: así se reutiliza la caché de la conversación en vez de reescribirla.
    const r = await $.model.fork({ prompt: pedidoMejorarConChat(fam, fecha, borrador) })
    if (!r.isAnswered && r.reason === 'nothing-to-fork') {
      $.ui.toast('Aún no hay conversación que aprovechar: usa Mejorar.')
      return
    }
    if (r.isAnswered) ({ prompt: nuevo, nota } = leerMejoraConChat(r.text))
  } else {
    const r = await $.model.complete({
      model: 'sonnet',
      system: sistemaMejorar(fam, fecha),
      prompt: `Borrador:\n${borrador}`,
      maxTokens: 4_000,
      effort: 'low',
      timeoutMs: 60_000,
    })
    nuevo = r.isAnswered ? r.text.trim() : ''
  }
  if (!nuevo) {
    $.ui.toast('No se pudo mejorar el prompt. Prueba de nuevo.')
    return
  }
  const hecho = await $.prompt.fill({ text: nuevo, mode: 'replace' }).catch(() => undefined)
  if (hecho?.isFilled) {
    await update($, previo, () => texto)
    const deChat = conChat ? ` Del chat: ${nota && nota.toLowerCase() !== 'nada' ? nota : 'nada'}.` : ''
    $.ui.toast(
      `Prompt mejorado con la guía de ${NOMBRE_FAMILIA[fam]}.${deChat} Revísalo antes de enviarlo; Deshacer recupera el tuyo.`,
      { timeoutMs: conChat ? 12_000 : 6_000 },
    )
    return
  }
  const copiado = await $.ui.copy({ text: nuevo }).catch(() => undefined)
  $.ui.toast(copiado ? 'No se pudo escribir en el cuadro de texto: el prompt mejorado está en el portapapeles.' : 'No se pudo escribir el prompt mejorado en el cuadro de texto.')
}

const deshacerMejora = async ($: EngineInterface) => {
  const texto = await read($, previo)
  if (texto === null) return
  const hecho = await $.prompt.fill({ text: texto, mode: 'replace' }).catch(() => undefined)
  if (hecho?.isFilled) await update($, previo, () => null)
}

const aplicarConsejo = async ($: EngineInterface) => {
  const c = await read($, consejo)
  if (!c) return
  // El modelo no se cambia desde el mod: la app lo guarda en su propio selector y se lo impone a la sesión.
  // Aquí solo se aplica el esfuerzo; el modelo lo elige la persona en el selector de la app.
  await $.command.run({ command: 'effort', args: c.esfuerzo })
  esfuerzo = c.esfuerzo
  const actual = await $.session.model().catch(() => '')
  $.ui.toast(
    familia(actual) === c.modelo
      ? `Esfuerzo ${c.esfuerzo} aplicado.`
      : `Esfuerzo ${c.esfuerzo} aplicado. El modelo cámbialo tú en el selector de la app: ${nombreModelo(ID_MODELO[c.modelo])}.`,
  )
  await update($, consejo, () => null)
  await refrescar($).catch(() => undefined)
}

// ---------- hooks ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'gasto',
      description: 'Abre el panel de gasto: hoy, últimos 7 días, por modelo y por proyecto',
    })
    await $.command.register({
      name: 'banda',
      description: 'Muestra u oculta la banda. Con "ironman" o "neutro" cambia sus colores',
    })
    const guardadas = ((await $.store.get('sesiones')) as Sesion[] | undefined) ?? []
    await update($, sesiones, () => guardadas)
    const prefiereDetalle = (await $.store.get('detalle')) === true
    await update($, detalle, () => prefiereDetalle)
    // El historial por turno se guarda por sesión: una recarga del mod no lo vacía.
    const idSesion = await $.session.id().catch(() => '')
    const previo = idSesion ? ((await $.store.get(`historial-${idSesion}`)) as Turno[] | undefined) : undefined
    const guardadasM = idSesion ? ((await $.store.get(`metricas-${idSesion}`)) as Metricas | undefined) : undefined
    if (guardadasM && typeof guardadasM.turnos === 'number' && Array.isArray(guardadasM.historial)) {
      await update($, metricas, x => (x.turnos === 0 ? { ...METRICAS_VACIAS, ...guardadasM } : x))
    } else if (previo && previo.length > 0) {
      await update($, metricas, x => (x.historial.length === 0 ? { ...x, historial: previo } : x))
    }
    const guardado: Tema = (await $.store.get('tema')) === 'neutro' ? 'neutro' : 'ironman'
    await update($, tema, () => guardado)
    await leerAutoCompact($).catch(() => undefined)
    const v = await refrescar($).catch(() => null)
    // Tras recargar el mod a mitad de sesión, el coste por turno parte del gasto actual,
    // no de cero: si no, el primer turno contaría todo lo gastado hasta ahora.
    if (v?.usd != null) {
      const usd = v.usd
      await update($, metricas, m => (m.turnos === 0 && m.base === 0 ? { ...m, base: usd } : m))
    }
    return next(e)
  })

  // /clear empieza una tarea nueva: se reinician las métricas de la sesión.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, metricas, () => METRICAS_VACIAS)
      avisadoNivel = 0
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'gasto' }, async $ => {
    await abrirPanel($)
    return { text: 'Panel de gasto abierto.', isTextDisplayOnly: true }
  })

  on('command.run', { command: 'banda' }, async ($, e) => {
    const pedido = e.args.trim().toLowerCase()
    if (pedido === 'ironman' || pedido === 'neutro') {
      await update($, tema, () => pedido)
      await $.store.set('tema', pedido)
      return { text: `Colores de la banda: ${pedido}.`, isTextDisplayOnly: true }
    }
    const estaba = await read($, oculta)
    await update($, oculta, () => !estaba)
    return {
      text: estaba ? 'Banda visible.' : 'Banda oculta. Vuelve a mostrarla con /banda.',
      isTextDisplayOnly: true,
    }
  })

  // Tras cambiar de modelo, de esfuerzo o compactar, la banda se pone al día.
  on('command.run', { command: ['model', 'effort', 'compact', 'clear'] }, async ($, e, next) => {
    const r = await next(e)
    if (e.command === 'compact') compactado = true
    void refrescar($).catch(() => undefined)
    return r
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const texto = e.text.trim()
    if (!e.isMeta && !e.command && texto && !texto.startsWith('/')) {
      void aconsejar($, texto).catch(() => undefined)
      void refrescar($).catch(() => undefined)
      ultimoPrompt = texto
      await update($, previo, () => null)
      await update($, consejo, () => null)
      const nombre = (texto.split('\n')[0] ?? '').slice(0, 60)
      await update($, metricas, m => (m.nombre === '' ? { ...m, nombre } : m))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // turn.step es un evento en streaming: el hook es un generador que reenvía el flujo tal cual.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      if (e.effort !== undefined) esfuerzo = String(e.effort)
      const modelo = e.model
      await update($, info, v =>
        v && (v.modelo !== modelo || v.esfuerzo !== esfuerzo) ? { ...v, modelo, esfuerzo } : v,
      )
    }
    return yield* next(e)
  })

  // Estado de los tests: resultado de la última ejecución, o pendiente si se toca código después.
  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Bash') {
      const r = await next(e)
      if (r.deny === undefined && esComandoTests(e.command)) {
        const estado = r.isError ? ('falla' as const) : ('ok' as const)
        const tests = { estado, ...contarTests(r.text ?? '') }
        await update($, metricas, m => ({ ...m, tests }))
      }
      return r
    }
    if (e.tool !== 'Edit' && e.tool !== 'Write') return next(e)
    const r = await next(e)
    if (r.deny === undefined && !r.isError && esCodigo(e.file_path)) {
      await update($, metricas, m =>
        m.tests.estado === 'ninguno' ? m : { ...m, tests: { ...m.tests, estado: 'viejo' as const } },
      )
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) {
      // Los tokens de un subagente cuentan; su coste ya va en el de la sesión.
      if (e.usage) await update($, metricas, m => ({ ...m, tokens: sumarTokens(m.tokens, e.usage!) }))
      return r
    }
    const valor = await refrescar($).catch(() => null)
    if (!valor) return r
    const m = await update($, metricas, x => {
      const usd = valor.usd ?? x.base
      // Un coste por debajo del anterior significa que el contador empezó de nuevo.
      const turno = usd >= x.base ? usd - x.base : usd
      const previo = x.historial[x.historial.length - 1]
      // Una caída fuerte del contexto también es una compactación (la automática incluida).
      const cayo = previo?.ctx != null && valor.ctx !== null && previo.ctx - valor.ctx > 15
      const u = e.usage
      const entrada = u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0
      const fila = {
        ctx: valor.ctx,
        coste: turno,
        cache: u && entrada > 0 ? Math.round((u.cache_read_input_tokens / entrada) * 100) : null,
        modelo: valor.modelo,
        ...(compactado || cayo ? { compactado: true } : {}),
      }
      return {
        ...x,
        historial: [...x.historial, fila].slice(-40),
        turnos: x.turnos + 1,
        base: usd,
        costesTurno: [...x.costesTurno, turno].slice(-20),
        ms: x.ms + e.durationMs,
        tokens: e.usage ? sumarTokens(x.tokens, e.usage) : x.tokens,
      }
    })
    compactado = false
    await leerAutoCompact($).catch(() => undefined)
    avisarContexto($, valor.ctxTokens)
    // Caché rota: un turno que apenas lee de caché cuando la sesión ya lleva varios.
    const uso = e.usage
    if (uso && m.turnos >= 3) {
      const entrada = uso.input_tokens + uso.cache_read_input_tokens + uso.cache_creation_input_tokens
      const leida = entrada > 0 ? Math.round((uso.cache_read_input_tokens / entrada) * 100) : 100
      if (entrada > 20_000 && leida < 50) {
        $.ui.toast(
          `Este turno solo leyó de caché el ${leida} %: algo la invalidó (cambio de modelo, MCP, una pausa larga). Ha costado más de lo normal.`,
          { timeoutMs: 10_000 },
        )
      }
    }
    await registrar($, valor, m.nombre).catch(() => undefined)
    const idSesion = await $.session.id().catch(() => '')
    if (idSesion) {
      await $.store.set(`historial-${idSesion}`, m.historial).catch(() => undefined)
      // Las métricas enteras también: si la app se reinicia o la sesión se retoma, no se pierden.
      await $.store.set(`metricas-${idSesion}`, m).catch(() => undefined)
    }
    return r
  }).catch(($, e, next) => next(e))

  // Banda encima del cuadro de texto. Si otro mod también dibuja aquí, se deja debajo.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, oculta))) return next(e)
    const guardado = await read($, info)
    if (!guardado) return next(e)
    // El modelo se lee en cada dibujo: si se cambia desde el selector de la app, no hay que esperar al siguiente turno.
    const vivo = await $.session.model().catch(() => '')
    const v = vivo && vivo !== guardado.modelo ? { ...guardado, modelo: vivo } : guardado
    const debajo = await next(e).catch(() => undefined)
    const m = await read($, metricas)
    const conDetalle = await read($, detalle)
    const { Box, Text, Button } = $.ui.resolve(e)
    // En la terminal se mide en celdas; en las superficies gráficas los botones ocupan más.
    const ancho = e.surface === 'terminal' ? e.props.bodyColumns : undefined
    const t = await read($, tema)
    const col = coloresTema(t)
    const c = await read($, consejo)
    // Nivel de los avisos de compactación: el botón sale en la compacta desde el suave y se resalta desde el claro.
    const nivelCtx = nivelContexto(v.ctxTokens, umbralesCompactar(autoCompact))
    const hayPrevio = (await read($, previo)) !== null

    // Una fila explícita: un fragmento suelto lo dibuja la app de escritorio en columna.
    // Todos los botones en un solo recuadro de borde redondeado y sin hueco entre ellos,
    // para que los gráficos de la izquierda tengan más sitio. En la terminal, sin borde
    // (ocuparía dos filas más) y con un espacio entre botones.
    const enTerminal = e.surface === 'terminal'
    const botones = (
      <Box
        flexDirection="row"
        alignItems="center"
        gap={enTerminal ? 1 : 0}
        flexShrink={0}
        {...(enTerminal ? {} : { borderStyle: 'round', borderDimColor: true, paddingX: 1 })}
      >
        {nivelCtx >= 2 && (
          // Desde el 50 %: recuadro rojo con ⚠ para que se vea sí o sí (Button no admite color propio).
          <Box
            key="compactar-alerta"
            flexShrink={0}
            {...(enTerminal ? {} : { borderStyle: 'round', borderColor: 'error', backgroundColor: 'error', paddingX: 1 })}
          >
            <Button
              key="compactar"
              variant="primary"
              label="Compactar…"
              onPress={() => prepararCompact($).catch(() => $.ui.toast('No se pudo preparar el /compact.'))}
            >
              <Text bold {...(enTerminal ? { color: 'error' } : {})}>⚠ Compactar…</Text>
            </Button>
          </Box>
        )}
        {nivelCtx < 2 && (conDetalle || nivelCtx >= 1) && (
          <Button
            key="compactar"
            plain
            label="Compactar…"
            onPress={() => prepararCompact($).catch(() => $.ui.toast('No se pudo preparar el /compact.'))}
          />
        )}
          <Button key="mejorar" plain label="Mejorar" onPress={() => mejorar($).catch(() => $.ui.toast('No se pudo mejorar el prompt.'))} />
          <Button
            key="mejorar-plus"
            plain
            label="Mejorar+"
            onPress={() => mejorar($, true).catch(() => $.ui.toast('No se pudo mejorar el prompt.'))}
          />
          {hayPrevio && (
            <Button key="deshacer" plain dimColor label="Deshacer" onPress={() => deshacerMejora($).catch(() => undefined)} />
          )}
        <Button
          key="recomendar"
          plain
          label="Recomendar"
          onPress={() => recomendar($).catch(() => $.ui.toast('No se pudo obtener una recomendación.'))}
        />
        {conDetalle && <Button key="copiar" plain label="Copiar" onPress={() => copiar($, e.surface)} />}
        {conDetalle && <Button key="gasto" plain label="Gasto" onPress={() => abrirPanel($)} />}
        <Button
          key="detalle"
          plain
          label={conDetalle ? '↘↖' : '↖↘'}
          onPress={() => alternarDetalle($)}
        />
        {conDetalle && (
          <Button key="ocultar" plain dimColor label="Ocultar" onPress={() => update($, oculta, () => true)} />
        )}
      </Box>
    )

    const filaConsejo = c ? (
      <Box flexDirection="row" alignItems="center" gap={2} width={ancho}>
        <Text color={c.igual ? col.success : col.valor} wrap="truncate-end">
          {textoConsejo(c)}
        </Text>
        <Box flexGrow={1} />
        <Box flexDirection="row" alignItems="center" gap={2} flexShrink={0}>
          {!c.igual && (
            <Button
              key="aplicar"
              variant="primary"
              label={c.mismoModelo ? 'Cambiar esfuerzo' : 'Aplicar esfuerzo'}
              onPress={() => aplicarConsejo($).catch(() => $.ui.toast('No se pudo cambiar. Usa /model y /effort.'))}
            />
          )}
          <Button key="descartar" plain dimColor label="Descartar" onPress={() => update($, consejo, () => null)} />
        </Box>
      </Box>
    ) : null

    const apilar = (mio: NonNullable<typeof debajo>) =>
      filaConsejo || debajo ? (
        <Box flexDirection="column">
          {mio}
          {filaConsejo}
          {debajo}
        </Box>
      ) : (
        mio
      )

    if (!conDetalle) {
      const lista = trozos(v, m)
      const tono = (x: (typeof lista)[number]) =>
        x.clase === 'success'
          ? col.success
          : x.clase === 'warning'
            ? col.warning
            : x.clase === 'error'
              ? col.error
              : x.clase === 'suave'
                ? col.suave
                : col.valor
      // En la app de escritorio, una sola imagen: los textos sueltos se parten en dos renglones.
      let datos = (
        <Box flexDirection="row" alignItems="center" gap={2} flexShrink={0}>
          <Text color={col.punto}>●</Text>
          {lista.map(x => (
            <Text color={tono(x)} bold={x.clase === 'cb'}>
              {x.texto}
            </Text>
          ))}
        </Box>
      )
      if (e.surface === 'desktop') {
        const { Svg } = $.ui.resolve(e)
        const ahora = await $.clock.now()
        const banda = svgBanda(v, m, ahora)
        // Sin tamaño fijo y en una caja que puede encoger: si la ventana es estrecha, el dibujo se reduce
        // y los botones no se salen del recuadro.
        datos = (
          <Box flexShrink={1} minWidth={0}>
            <Svg source={banda} alt={lista.map(x => x.texto).join(' · ')} />
          </Box>
        )
      }
      return apilar(
        <Box flexDirection="row" alignItems="center" gap={2} width={ancho}>
          {datos}
          <Box flexGrow={1} />
          {botones}
        </Box>,
      )
    }

    const cols = columnas(v, m)
    let cifras = (
      <Box flexDirection="column">
        <Text dimColor wrap="truncate-end">
          {'─'.repeat(e.props.bodyColumns)}
        </Text>
        <Box flexDirection="row" gap={2}>
          {cols.map(c => (
            <Box
              key={c.clave}
              flexDirection="column"
              {...(ancho === undefined
                ? { flexGrow: 1 }
                : { width: Math.max(10, Math.floor(ancho / cols.length) - 2) })}
            >
              <Text dimColor>{c.etiqueta}</Text>
              <Text bold color={c.tono ? col[c.tono] : col.valor}>
                {c.valor}
              </Text>
              <Text dimColor wrap="truncate-end">
                {c.apunte}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
    // En la app de escritorio, un solo dibujo: línea de tiempo, límite de 5 h y cifras.
    // Sin ancho fijo: la app lo encoge al ancho de la banda y nada se corta.
    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      const ahora = await $.clock.now()
      cifras = (
        <Svg
          source={svgDetalleLinea(v, m, ahora)}
          alt={cols.map(c => `${c.etiqueta} ${c.valor}`).join(', ')}
        />
      )
    }

    return apilar(
      <Box flexDirection="column" width={ancho} gap={e.surface === 'desktop' ? 1 : 0}>
        <Box flexDirection="row" alignItems="center" gap={2}>
          <Box flexShrink={0}>
            <Text bold wrap="truncate-end">
              {`${nombreModelo(v.modelo)}${v.esfuerzo ? ` · ${v.esfuerzo}` : ''}`}
            </Text>
          </Box>
          {e.surface !== 'desktop' && m.nombre !== '' && (
            <Text dimColor wrap="truncate-end">
              {m.nombre}
            </Text>
          )}
          <Box flexGrow={1} />
          {botones}
        </Box>
        {cifras}
      </Box>,
    )
  }).catch(($, e, next) => next(e))

  // Panel de gasto.
  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const lista = await read($, sesiones)
    const ahora = await $.clock.now()
    const hoy = dia(ahora)
    const semana = new Set(Array.from({ length: 7 }, (_, i) => dia(ahora - i * DIA_MS)))
    const deHoy = lista.filter(s => s.dia === hoy)
    const deSemana = lista.filter(s => semana.has(s.dia))

    // En la app de escritorio: el diseño de Panel.dc.html, con el selector de periodo encima.
    if (e.surface === 'desktop') {
      const { Svg, Button } = $.ui.resolve(e)
      const r = await read($, rango)
      const uso = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
      const contexto =
        uso?.context.breakdown?.categories
          .filter(c => c.kind === 'used')
          .map(c => ({ nombre: c.name, tokens: c.tokens })) ?? null
      const chispas: Record<string, number[]> = {}
      for (const s of [...delRango(lista, r, ahora)].sort((a, b) => b.ultima - a.ultima).slice(0, 5)) {
        const h = (await $.store.get(`historial-${s.id}`).catch(() => undefined)) as { coste: number }[] | undefined
        if (!Array.isArray(h)) continue
        let acc = 0
        chispas[s.id] = h.map(t => (acc += typeof t?.coste === 'number' ? t.coste : 0))
      }
      const svg = svgPanel({
        rango: r,
        sesiones: lista,
        ahora,
        contexto,
        ctxTokens: uso?.context.tokens ?? null,
        ventana: uso?.context.window ?? null,
        chispas,
      })
      const opcion = (valor: Rango, etiqueta: string) => (
        <Button
          key={`rango-${valor}`}
          {...(r === valor ? { variant: 'primary' as const } : { plain: true as const })}
          label={etiqueta}
          onPress={() => update($, rango, () => valor)}
        />
      )
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1}>
            {opcion('hoy', 'Hoy')}
            {opcion('7', '7 días')}
            {opcion('30', '30 días')}
          </Box>
          <Svg source={svg} {...medidas(svg)} alt="Gasto por día, por modelo, contexto y últimas sesiones" />
          <Text dimColor>
            Coste estimado por Claude Code a precio de lista. Solo cuenta las sesiones con este mod activo. Para el
            histórico completo: npx ccusage@20.0.48 daily
          </Text>
        </Box>
      )
    }

    if (lista.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Aún no hay sesiones registradas. Se apuntan al terminar cada turno.</Text>
        </Box>
      )
    }

    const filas = (titulo: string, datos: [string, number][]) => (
      <Box flexDirection="column" key={titulo}>
        <Text weight="semibold">{titulo}</Text>
        {datos.slice(0, 8).map(([k, v]) => (
          <Text key={k}>
            {dinero(v).padStart(8)}  {k}
          </Text>
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Text weight="bold">
          Hoy: {dinero(sumar(deHoy))} · {deHoy.length} {deHoy.length === 1 ? 'sesión' : 'sesiones'}
        </Text>
        <Text>
          Últimos 7 días: {dinero(sumar(deSemana))} · {deSemana.length}{' '}
          {deSemana.length === 1 ? 'sesión' : 'sesiones'}
        </Text>
        <Text> </Text>
        {filas(
          'Por día',
          agrupar(deSemana, s => s.dia).sort((a, b) => (a[0] < b[0] ? 1 : -1)),
        )}
        <Text> </Text>
        {filas('Por modelo (7 días)', agrupar(deSemana, s => s.modelo))}
        <Text> </Text>
        {filas('Por proyecto (7 días)', agrupar(deSemana, s => s.proyecto))}
        <Text> </Text>
        <Text weight="semibold">Últimas sesiones</Text>
        {[...lista]
          .reverse()
          .slice(0, 8)
          .map(s => (
            <Text key={s.id} wrap="truncate-end">
              {dinero(s.usd).padStart(8)}  {s.dia}  {s.nombre || s.proyecto} · {s.modelo}
            </Text>
          ))}
        <Text> </Text>
        <Text dimColor>
          Coste estimado por Claude Code a precio de lista. Solo cuenta las sesiones con este mod
          activo. Para el histórico completo: npx ccusage@20.0.48 daily
        </Text>
      </Box>
    )
  })

  // Marca en la fila de los tests filtrados por el hook del plugin elegir-modelo.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const fila = await next(e)
    if (e.props.tool !== 'Bash' || e.props.isRunning) return fila
    const comando = (e.props.input as { command?: unknown } | null)?.command
    if (typeof comando !== 'string' || !comando.includes('filtrar-tests.sh')) return fila
    const texto = textoSalida(e.props.output)
    const m = /Salida de (\d+) líneas filtrada/.exec(texto)
    if (!m) return fila
    const recibidas = texto.split('\n').filter(l => l.trim()).length
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {fila}
        <Text dimColor>
          Salida de tests filtrada: {m[1]} → {recibidas} líneas
        </Text>
      </Box>
    )
  })
}

const textoSalida = (salida: unknown): string => {
  if (typeof salida === 'string') return salida
  if (salida && typeof salida === 'object') {
    const o = salida as Record<string, unknown>
    if (typeof o.stdout === 'string') return o.stdout
    if (typeof o.output === 'string') return o.output
    try {
      return JSON.stringify(salida)
    } catch {
      return ''
    }
  }
  return ''
}

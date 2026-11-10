// Gráficos de la banda para la app de escritorio, como SVG. Funciones puras: sin `$`.
// Diseño elegido en Claude Design: banda compacta "con gráficos" y detalle "línea de tiempo".

import type { Info, Metricas, Turno } from '../types'
import { dinero, familia, fmtTokens, nombreModelo, tiempo } from './util'

const FUENTE = "'Segoe UI', Inter, -apple-system, system-ui, sans-serif"

// Paleta validada para daltonismo (fondo oscuro), con su versión para fondo claro.
const ESTILO =
  `text{font-family:${FUENTE}}.t{fill:#f0efec}.m{fill:#c3c2b7}.g{stroke:#383835}.w{fill:#fab219}.ws{stroke:#fab219}` +
  `.ctx{stroke:#3987e5}.ctxf{fill:#3987e5}.cos{fill:#d95926}.cac{stroke:#199e70}.bg{fill:#383835}` +
  `.opus{stroke:#86b6ef}.fable{stroke:#d95926}.sonnet{stroke:#199e70}.haiku{stroke:#c98500}.otro{stroke:#c3c2b7}` +
  `@media (prefers-color-scheme:light){.t{fill:#1f1e1d}.m{fill:#52514e}.g{stroke:#d8d7d2}.bg{fill:#e4e3de}` +
  `.w{fill:#a86400}.ws{stroke:#a86400}.ctx{stroke:#2a78d6}.ctxf{fill:#2a78d6}.cos{fill:#c4501f}.cac{stroke:#138a5f}` +
  `.opus{stroke:#2a78d6}.fable{stroke:#c4501f}.sonnet{stroke:#138a5f}.haiku{stroke:#9a6700}.otro{stroke:#52514e}}`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const n1 = (x: number) => (Math.round(x * 10) / 10).toString()
const anchoTexto = (s: string, px: number) => s.length * px * 0.56

const claseModelo = (modelo: string) => {
  const f = familia(modelo)
  return f === 'opus' || f === 'fable' || f === 'sonnet' || f === 'haiku' ? f : 'otro'
}

const nombreCorto = (modelo: string) => {
  const f = familia(modelo)
  return f ? f[0]!.toUpperCase() + f.slice(1) : 'modelo'
}

/** Índices de los turnos en los que cambió el modelo respecto al anterior. */
export const cambiosDeModelo = (h: readonly Turno[]) =>
  h.flatMap((t, i) => (i > 0 && familia(t.modelo) !== familia(h[i - 1]!.modelo) ? [i] : []))

/** Ritmo uniforme del límite de 5 h: la parte de la ventana ya transcurrida, de 0 a 100. */
export const ritmo5h = (resetsAt: number | null, ahora: number) => {
  if (resetsAt === null) return null
  const restante = resetsAt - ahora
  const ventana = 5 * 3_600_000
  if (restante < 0 || restante > ventana) return null
  return ((ventana - restante) / ventana) * 100
}

const hora = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---------- banda compacta ----------

export function svgBanda(v: Info, m: Metricas, ahora: number): string {
  // Dos renglones para que el dibujo quepa junto a los botones a tamaño real (la app lo
  // encogía al ponerlo en un solo renglón): arriba modelo y contexto; abajo coste y límite de 5 h.
  const h = m.historial.slice(-12)
  const alto = 48
  let x = 0
  let base = 17
  let cuerpo = ''
  let ancho = 0

  const texto = (s: string, clase: string, px = 13, peso = 400) => {
    cuerpo += `<text x="${n1(x)}" y="${base}" font-size="${px}" font-weight="${peso}" class="${clase}">${esc(s)}</text>`
    x += anchoTexto(s, px) + (peso >= 600 ? s.length * 0.4 : 0)
  }
  const finRenglon = () => {
    ancho = Math.max(ancho, x)
    x = 0
  }

  // Renglón 1: modelo, esfuerzo y línea del contexto con marcas donde cambió el modelo.
  texto(nombreModelo(v.modelo), 't', 13, 600)
  if (v.esfuerzo) {
    x += 5
    texto(v.esfuerzo, 'm', 13)
  }
  x += 12
  const w = 90
  if (h.length < 2) {
    const cy = 3 + (1 - Math.min(50, v.ctx ?? 0) / 50) * 17
    cuerpo += `<line x1="${n1(x)}" y1="${n1(cy)}" x2="${n1(x + w)}" y2="${n1(cy)}" class="ctx" stroke-opacity="0.35" stroke-width="2" stroke-dasharray="2 3"/>`
    cuerpo += `<circle cx="${n1(x + w)}" cy="${n1(cy)}" r="3" class="ctxf"/>`
  } else {
    const vmax = Math.max(50, ...h.map(t => t.ctx ?? 0))
    const px = (i: number) => x + (i * w) / (h.length - 1)
    const py = (c: number) => 3 + (1 - c / vmax) * 17
    for (const i of cambiosDeModelo(h)) {
      cuerpo += `<line x1="${n1(px(i))}" y1="1" x2="${n1(px(i))}" y2="21" class="${claseModelo(h[i]!.modelo)}" stroke-opacity="0.5" stroke-dasharray="2 2"/>`
    }
    const pts = h.map((t, i) => `${n1(px(i))},${n1(py(t.ctx ?? 0))}`).join(' ')
    cuerpo += `<polyline points="${pts}" fill="none" class="ctx" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    const ult = h[h.length - 1]!
    cuerpo += `<circle cx="${n1(px(h.length - 1))}" cy="${n1(py(ult.ctx ?? 0))}" r="3" class="ctxf"/>`
  }
  x += w + 8
  texto('ctx ', 't', 13)
  x -= 4
  texto(v.ctx === null ? '–' : `${Math.round(v.ctx)} %`, 't', 13, 600)
  finRenglon()

  // Renglón 2: barritas de coste por turno (la última, resaltada), total y último turno.
  base = 42
  if (h.length >= 1) {
    const max = Math.max(...h.map(t => t.coste), 0.0001)
    h.forEach((t, i) => {
      const alt = Math.max(1.5, (t.coste / max) * 17)
      const op = i === h.length - 1 ? '1' : '0.55'
      cuerpo += `<rect x="${n1(x + i * 7)}" y="${n1(45 - alt)}" width="5" height="${n1(alt)}" rx="1" class="cos" opacity="${op}"/>`
    })
    x += h.length * 7 + 6
  }
  if (v.usd !== null) {
    texto(dinero(v.usd), 't', 13, 600)
    const ultimo = m.costesTurno[m.costesTurno.length - 1]
    if (ultimo !== undefined) {
      x += 6
      texto(`+${dinero(ultimo)}`, 'm', 12)
    }
    x += 14
  }

  // Límite de 5 h: barra con la marca del ritmo uniforme.
  if (v.limite5h !== null) {
    texto('5 h', 'm', 12)
    x += 8
    const wb = 80
    const pct = Math.max(0, Math.min(100, v.limite5h))
    cuerpo += `<rect x="${n1(x)}" y="34" width="${wb}" height="7" rx="3.5" class="bg"/>`
    cuerpo += `<rect x="${n1(x)}" y="34" width="${n1(Math.max(3, (wb * pct) / 100))}" height="7" rx="3.5" class="ctxf"/>`
    const r = ritmo5h(v.resets5h, ahora)
    if (r !== null) {
      cuerpo += `<rect x="${n1(x + (wb * r) / 100 - 1)}" y="30" width="2" height="15" class="m"/>`
    }
    x += wb + 8
    texto(`${Math.round(pct)} %`, r !== null && pct > r ? 'w' : 't', 13, 600)
  }
  finRenglon()

  const total = Math.ceil(ancho + 4)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${alto}" viewBox="0 0 ${total} ${alto}"><style>${ESTILO}</style>${cuerpo}</svg>`
}

// ---------- detalle: línea de tiempo + límite de 5 h + cifras, en un solo dibujo ----------

// Un único SVG de 740 x 184 (cabe en la banda sin desplazarse): la app lo encoge al ancho de la banda si hace falta, así que
// nada se corta. A la izquierda, tres gráficos con el mismo eje de turnos; a la derecha,
// el medidor del límite de 5 h y las cifras de la sesión.
export function svgDetalleLinea(v: Info, m: Metricas, ahora: number): string {
  const W = 740
  const H = 184
  const h = m.historial.slice(-40)
  const x0 = 62
  // El gráfico acaba en 500: a la derecha queda sitio para el % del contexto, sin pisar la línea.
  const x1 = 500
  // Al menos 12 huecos: al empezar, los turnos se van colocando desde la izquierda.
  const n = Math.max(h.length, 12)
  const hueco = (x1 - x0) / n
  const px = (i: number) => x0 + (i + 0.5) * hueco
  let c = ''

  // Marcos de los tres gráficos.
  const yC = (p: number) => 78 - (Math.min(100, p) / 100) * 46
  const yK = (p: number) => 166 - (Math.min(100, p) / 100) * 24
  c += `<text x="0" y="60" font-size="12" font-weight="600" class="t">Contexto</text>`
  c += `<text x="0" y="118" font-size="12" font-weight="600" class="t">Coste</text>`
  c += `<text x="0" y="160" font-size="12" font-weight="600" class="t">Caché</text>`
  c += `<line x1="${x0}" y1="78" x2="${x1}" y2="78" class="g"/>`
  c += `<line x1="${x0}" y1="128" x2="${x1}" y2="128" class="g"/>`
  c += `<line x1="${x0}" y1="166" x2="${x1}" y2="166" class="g"/>`
  c += `<line x1="${x0}" y1="${n1(yC(70))}" x2="${x1}" y2="${n1(yC(70))}" class="ws" stroke-opacity="0.55" stroke-dasharray="4 3"/>`
  c += `<line x1="${x0}" y1="${n1(yK(70))}" x2="${x1}" y2="${n1(yK(70))}" class="ws" stroke-opacity="0.55" stroke-dasharray="4 3"/>`
  c += `<text x="${x0 - 6}" y="${n1(yC(70) + 3)}" text-anchor="end" font-size="10" class="w">70</text>`

  if (h.length === 0) {
    c += `<text x="${(x0 + x1) / 2}" y="104" text-anchor="middle" font-size="12" class="m">Se rellena turno a turno</text>`
  } else {
    // Eventos: cambios de modelo y compactaciones; dos filas de etiquetas para que no se pisen.
    // Se guarda dónde acaba la última etiqueta de cada fila; una etiqueta solo se pone si cabe.
    const finFila = [-Infinity, -Infinity]
    const evento = (i: number, clase: string, etiqueta: string) => {
      const x = px(i) - hueco / 2
      c += `<line x1="${n1(x)}" y1="27" x2="${n1(x)}" y2="166" class="${clase}" stroke-opacity="0.55" stroke-dasharray="2 3"/>`
      const w = etiqueta.length * 5.9
      const alFinal = x + 4 + w > x1
      const ini = alFinal ? x - 4 - w : x + 4
      const fila = finFila.findIndex(f => ini > f + 10)
      if (fila === -1) return
      c += `<text x="${n1(ini)}" y="${fila === 0 ? 10 : 22}" font-size="10.5" class="t">${esc(etiqueta)}</text>`
      finFila[fila] = ini + w
    }
    const cambios = new Set(cambiosDeModelo(h))
    h.forEach((t, i) => {
      if (cambios.has(i)) evento(i, claseModelo(t.modelo), `→ ${nombreCorto(t.modelo)}`)
      if (t.compactado) evento(i, 'otro', '/compact')
    })

    // Contexto.
    const fin = h.length - 1
    const ptsC = h.map((t, i) => `${n1(px(i))},${n1(yC(t.ctx ?? 0))}`).join(' ')
    if (h.length >= 2) {
      c += `<polygon points="${ptsC} ${n1(px(fin))},78 ${n1(px(0))},78" class="ctxf" fill-opacity="0.2"/>`
      c += `<polyline points="${ptsC}" fill="none" class="ctx" stroke-width="2" stroke-linejoin="round"/>`
    }
    const ult = h[fin]!
    c += `<circle cx="${n1(px(fin))}" cy="${n1(yC(ult.ctx ?? 0))}" r="4" class="ctxf" stroke="#262626" stroke-width="2"/>`
    if (ult.ctx !== null) {
      c += `<text x="${n1(px(fin) + 9)}" y="${n1(yC(ult.ctx) + 4)}" font-size="11" font-weight="600" class="t">${Math.round(ult.ctx)} %</text>`
    }

    // Coste por turno, dentro de su hueco; se rotula el más caro.
    const max = Math.max(...h.map(t => t.coste), 0.0001)
    const bw = Math.max(3, Math.min(16, hueco * 0.6))
    let iMax = 0
    h.forEach((t, i) => {
      if (t.coste > h[iMax]!.coste) iMax = i
      const alt = Math.max(1.5, (t.coste / max) * 26)
      c += `<rect x="${n1(px(i) - bw / 2)}" y="${n1(128 - alt)}" width="${n1(bw)}" height="${n1(alt)}" rx="${bw >= 8 ? 3 : 1.5}" class="cos" opacity="${i === fin ? '1' : '0.6'}"/>`
    })
    const altMax = Math.max(1.5, (h[iMax]!.coste / max) * 26)
    c += `<text x="${n1(px(iMax))}" y="${n1(Math.max(91, 128 - altMax - 6))}" text-anchor="middle" font-size="11" class="t">${dinero(h[iMax]!.coste)}</text>`

    // Caché leída por turno, con aviso por debajo del 70 %.
    const conCache = h.map((t, i) => [i, t.cache] as const).filter((p): p is readonly [number, number] => p[1] !== null)
    if (conCache.length >= 2) {
      c += `<polyline points="${conCache.map(([i, p]) => `${n1(px(i))},${n1(yK(p))}`).join(' ')}" fill="none" class="cac" stroke-width="2" stroke-linejoin="round"/>`
    }
    for (const [i, p] of conCache) {
      if (p < 70) c += `<circle cx="${n1(px(i))}" cy="${n1(yK(p))}" r="3.5" class="w" stroke="#262626" stroke-width="2"/>`
      else if (conCache.length < 2) c += `<circle cx="${n1(px(i))}" cy="${n1(yK(p))}" r="3" fill="none" class="cac" stroke-width="2"/>`
    }

    // Eje de turnos.
    const primero = m.turnos - h.length + 1
    c += `<text x="${n1(px(0))}" y="181" text-anchor="middle" font-size="10" class="m">turno ${Math.max(1, primero)}</text>`
    if (fin > 1) c += `<text x="${n1(px(fin))}" y="181" text-anchor="middle" font-size="10" class="m">turno ${Math.max(m.turnos, h.length)}</text>`
  }

  // Columna derecha: límite de 5 h y cifras.
  const cx0 = 556
  const cxm = 648
  c += `<line x1="538" y1="4" x2="538" y2="180" class="g"/>`
  let y = 22
  if (v.limite5h !== null) {
    const pct = Math.max(0, Math.min(100, v.limite5h))
    const ritmo = ritmo5h(v.resets5h, ahora)
    const punto = (f: number, r: number) => {
      const a = Math.PI * Math.max(0, Math.min(1, f))
      return [cxm - r * Math.cos(a), 62 - r * Math.sin(a)] as const
    }
    c += `<text x="${cx0}" y="12" font-size="12" class="m">Límite de 5 h</text>`
    c += `<path d="M${cxm - 36} 62 A36 36 0 0 1 ${cxm + 36} 62" fill="none" class="g" stroke-width="8" stroke-linecap="round"/>`
    if (pct > 0) {
      const [ex, ey] = punto(pct / 100, 36)
      c += `<path d="M${cxm - 36} 62 A36 36 0 0 1 ${n1(ex)} ${n1(ey)}" fill="none" class="${ritmo !== null && pct > ritmo ? 'ws' : 'ctx'}" stroke-width="8" stroke-linecap="round"/>`
    }
    if (ritmo !== null) {
      const [ax, ay] = punto(ritmo / 100, 29)
      const [bx, by] = punto(ritmo / 100, 43)
      c += `<line x1="${n1(ax)}" y1="${n1(ay)}" x2="${n1(bx)}" y2="${n1(by)}" class="otro" stroke-width="2"/>`
    }
    c += `<text x="${cxm}" y="60" text-anchor="middle" font-size="17" font-weight="600" class="t">${Math.round(pct)} %</text>`
    const frase = proyeccion5h(pct, ritmo, v.resets5h)
    if (frase) c += `<text x="${cxm}" y="80" text-anchor="middle" font-size="11" class="m">${esc(frase)}</text>`
    c += `<line x1="${cx0}" y1="89" x2="${W}" y2="89" class="g"/>`
    y = 105
  }
  const ultimoCoste = m.costesTurno[m.costesTurno.length - 1]
  const entrada = m.tokens.entrada + m.tokens.cacheLee + m.tokens.cacheEscribe
  const filas: [string, string][] = [
    ['Sesión', v.usd === null ? '–' : dinero(v.usd)],
    ['Último turno', ultimoCoste === undefined ? '–' : dinero(ultimoCoste)],
    ['Por turno', m.historial.length > 0 ? dinero(m.historial.reduce((t, x) => t + x.coste, 0) / m.historial.length) : '–'],
    ['Caché', entrada < 1000 ? '–' : `${Math.round((m.tokens.cacheLee / entrada) * 100)} %`],
    ['Tiempo', tiempo(m.ms)],
  ]
  if (m.tests.estado !== 'ninguno') {
    filas.push([
      'Tests',
      m.tests.estado === 'ok' ? `✓ ${m.tests.pasan ?? ''} pasan` : m.tests.estado === 'falla' ? `✗ ${m.tests.fallan ?? ''} fallan` : 'pendientes',
    ])
  }
  const paso = v.limite5h !== null ? 15 : 22
  filas.forEach(([k, val], i) => {
    const yy = y + i * paso
    c += `<text x="${cx0}" y="${yy}" font-size="12" class="m">${esc(k)}</text>`
    c += `<text x="${W}" y="${yy}" text-anchor="end" font-size="12" font-weight="${i === 0 ? 600 : 400}" class="t">${esc(val)}</text>`
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${ESTILO}</style>${c}</svg>`
}

/** Frase de proyección del límite de 5 h al ritmo actual. */
export function proyeccion5h(pct: number, ritmo: number | null, resetsAt: number | null): string {
  if (ritmo === null || resetsAt === null || ritmo < 5) return resetsAt === null ? '' : `se renueva a las ${hora(resetsAt)}`
  const final = Math.round((pct / ritmo) * 100)
  return final >= 100
    ? `se agota antes de las ${hora(resetsAt)}`
    : `≈${final} % al renovarse (${hora(resetsAt)})`
}

export const resumenTokens = (m: Metricas) =>
  fmtTokens(m.tokens.entrada + m.tokens.salida + m.tokens.cacheLee + m.tokens.cacheEscribe)

export { tiempo }

/** Ancho y alto declarados en un SVG: la app lo estira al ancho disponible si no se le pasan. */
export const medidas = (svg: string): { width: number; height: number } | Record<string, never> => {
  const m = /<svg[^>]*\swidth="(\d+(?:\.\d+)?)"[^>]*\sheight="(\d+(?:\.\d+)?)"/.exec(svg)
  return m ? { width: Number(m[1]), height: Number(m[2]) } : {}
}

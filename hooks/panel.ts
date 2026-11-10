// Panel de gasto (/gasto) en la app de escritorio: un único SVG con el diseño de Panel.dc.html.
// Cifras clave, barras por día, donut por modelo, composición del contexto y tarjetas de sesión.
import type { Sesion } from '../types'
import { DIA_MS, dia, dinero, familia } from './util'

export type Rango = 'hoy' | '7' | '30'

export type ParteContexto = { nombre: string; tokens: number }

export type DatosPanel = {
  rango: Rango
  sesiones: readonly Sesion[]
  ahora: number
  /** Lo que ocupa el contexto de esta sesión, por categoría; null si no se pudo leer. */
  contexto: readonly ParteContexto[] | null
  ctxTokens: number | null
  ventana: number | null
  /** Coste acumulado turno a turno de cada sesión, por id, para el minigráfico de su tarjeta. */
  chispas: Readonly<Record<string, readonly number[]>>
}

const W = 436
const FUENTE = "'Segoe UI', Inter, -apple-system, system-ui, sans-serif"
// Colores del mod (paleta oscura validada) y su versión clara.
const ESTILO =
  `text{font-family:${FUENTE}}.t{fill:#f0efec}.m{fill:#c3c2b7}.g{stroke:#383835}.card{fill:#262626}` +
  `.c0{fill:#3987e5}.c1{fill:#d95926}.c2{fill:#199e70}.c3{fill:#c98500}.c4{fill:#8a8984}` +
  `.s0{stroke:#3987e5}.s1{stroke:#d95926}.s2{stroke:#199e70}.s3{stroke:#c98500}.s4{stroke:#8a8984}` +
  `@media (prefers-color-scheme:light){.t{fill:#1f1e1d}.m{fill:#52514e}.g{stroke:#d8d7d2}.card{fill:#efeee9}` +
  `.c0{fill:#2a78d6}.c1{fill:#c4501f}.c2{fill:#138a5f}.c3{fill:#9a6700}.c4{fill:#6e6d68}` +
  `.s0{stroke:#2a78d6}.s1{stroke:#c4501f}.s2{stroke:#138a5f}.s3{stroke:#9a6700}.s4{stroke:#6e6d68}}`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const n1 = (x: number) => (Math.round(x * 10) / 10).toString()
const recorta = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s)
const k = (t: number) => (t >= 1_000_000 ? `${n1(t / 1_000_000)}M` : t >= 1000 ? `${Math.round(t / 1000)}k` : `${t}`)

// El color sigue al modelo, nunca a su puesto en el ranking.
const ORDEN_MODELO = ['opus', 'fable', 'sonnet', 'haiku'] as const
const colorModelo = (modelo: string) => {
  const f = familia(modelo) === 'mythos' ? 'fable' : familia(modelo)
  const i = ORDEN_MODELO.indexOf(f as (typeof ORDEN_MODELO)[number])
  return i < 0 ? 4 : i
}

const LETRA = ['D', 'L', 'M', 'X', 'J', 'V', 'S']
const DIA_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

const cuando = (ms: number, ahora: number) => {
  const d = new Date(ms)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (dia(ms) === dia(ahora)) return `hoy ${hhmm}`
  if (dia(ms) === dia(ahora - DIA_MS)) return `ayer ${hhmm}`
  if (ahora - ms < 7 * DIA_MS) return `${DIA_SEMANA[d.getDay()]} ${hhmm}`
  return `${d.getDate()}/${d.getMonth() + 1} ${hhmm}`
}

// Nombres de /context en castellano; lo desconocido se deja como viene.
const NOMBRES_CTX: Record<string, string> = {
  'system prompt': 'Sistema',
  'system tools': 'Herramientas',
  'mcp tools': 'MCP',
  'custom agents': 'Agentes',
  'memory files': 'CLAUDE.md y memoria',
  skills: 'Skills',
  messages: 'Mensajes',
}
const nombreCtx = (s: string) => NOMBRES_CTX[s.toLowerCase()] ?? s
const esMensajes = (s: string) => /^messages$/i.test(s)

/** Las sesiones que cuentan en el rango elegido. */
export const delRango = (lista: readonly Sesion[], rango: Rango, ahora: number) => {
  const n = rango === 'hoy' ? 1 : Number(rango)
  const dias = new Set(Array.from({ length: n }, (_, i) => dia(ahora - i * DIA_MS)))
  return lista.filter(s => dias.has(s.dia))
}

export function svgPanel(d: DatosPanel): string {
  const { ahora } = d
  const hoy = dia(ahora)
  const suma = (l: readonly Sesion[]) => l.reduce((t, s) => t + s.usd, 0)
  const deHoy = d.sesiones.filter(s => s.dia === hoy)
  const enRango = delRango(d.sesiones, d.rango, ahora)
  const nDias = d.rango === '30' ? 30 : 7
  let y = 0
  let c = ''
  const texto = (x: number, yy: number, s: string, clase: string, tam: number, peso = 400, ancla = 'start') =>
    `<text x="${n1(x)}" y="${n1(yy)}" font-size="${tam}"${peso !== 400 ? ` font-weight="${peso}"` : ''}${
      ancla !== 'start' ? ` text-anchor="${ancla}"` : ''
    } class="${clase}">${esc(s)}</text>`
  const ses = (n: number) => `${n} ${n === 1 ? 'sesión' : 'sesiones'}`

  // 1. Cifras clave: hoy y el periodo (7 o 30 días).
  const periodo = d.rango === '30' ? 'Últimos 30 días' : 'Últimos 7 días'
  const dePeriodo = delRango(d.sesiones, d.rango === '30' ? '30' : '7', ahora)
  c += texto(0, 14, 'Hoy', 'm', 12)
  c += texto(0, 46, dinero(suma(deHoy)), 't', 28, 600)
  c += texto(0, 66, ses(deHoy.length), 'm', 12)
  const dx = W / 2 + 6
  c += texto(dx, 14, periodo, 'm', 12)
  c += texto(dx, 46, dinero(suma(dePeriodo)), 't', 28, 600)
  c += texto(dx, 66, `⌀ ${dinero(suma(dePeriodo) / nDias)} al día · ${ses(dePeriodo.length)}`, 'm', 12)
  y = 98

  // 2. Barras por día.
  c += texto(0, y, 'Por día', 't', 13, 600)
  const top = y + 26
  const base = y + 124
  const dias = Array.from({ length: nDias }, (_, i) => ahora - (nDias - 1 - i) * DIA_MS)
  const valores = dias.map(ms => suma(d.sesiones.filter(s => s.dia === dia(ms))))
  const max = Math.max(...valores, 0.01)
  // Dos líneas guía con valores redondos.
  const paso = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000].find(p => p * 2 >= max) ?? Math.ceil(max / 2)
  const tope = paso * 2
  const py = (v: number) => base - (v / tope) * (base - top)
  const x0 = 26
  const x1 = W - 2
  c += `<line x1="${x0}" y1="${base}" x2="${x1}" y2="${base}" class="g"/>`
  for (const g of [paso, paso * 2]) {
    c += `<line x1="${x0}" y1="${n1(py(g))}" x2="${x1}" y2="${n1(py(g))}" class="g" stroke-dasharray="2 3"/>`
    c += texto(x0 - 5, py(g) + 3.5, `${g}`, 'm', 10, 400, 'end')
  }
  const hueco = (x1 - x0) / nDias
  const ancho = Math.min(34, hueco - 2)
  valores.forEach((v, i) => {
    const cx = x0 + (i + 0.5) * hueco
    const esHoy = i === nDias - 1
    if (v > 0) {
      const alto = Math.max(2, base - py(v))
      c += `<rect x="${n1(cx - ancho / 2)}" y="${n1(base - alto)}" width="${n1(ancho)}" height="${n1(alto)}" rx="${n1(Math.min(4, ancho / 3))}" class="c0"${esHoy ? '' : ' opacity="0.45"'}/>`
    }
    if (esHoy && v > 0) c += texto(cx, py(v) - 6, dinero(v), 't', 11, 600, nDias === 30 ? 'end' : 'middle')
    const fecha = new Date(dias[i]!)
    const etiqueta = esHoy
      ? 'Hoy'
      : nDias === 7
        ? LETRA[fecha.getDay()]!
        : (nDias - 1 - i) % 5 === 0
          ? `${fecha.getDate()}`
          : ''
    if (etiqueta) c += texto(cx, base + 16, etiqueta, esHoy ? 't' : 'm', 10, esHoy ? 600 : 400, esHoy && nDias === 30 ? 'end' : 'middle')
  })
  y = base + 42

  // 3. Donut por modelo, en el rango elegido.
  const porModelo = new Map<string, number>()
  for (const s of enRango) porModelo.set(s.modelo, (porModelo.get(s.modelo) ?? 0) + s.usd)
  const filas = [...porModelo.entries()].filter(([, usd]) => usd > 0).sort((a, b) => b[1] - a[1])
  const total = suma(enRango)
  const r = 40
  const cx = 55
  const cy = y + 55
  const circ = 2 * Math.PI * r
  if (total > 0) {
    let off = 0
    const gap = filas.length > 1 ? 2 : 0
    c += `<g transform="rotate(-90 ${cx} ${n1(cy)})">`
    for (const [modelo, usd] of filas) {
      const largo = Math.max(0.5, (usd / total) * circ - gap)
      c += `<circle cx="${cx}" cy="${n1(cy)}" r="${r}" fill="none" stroke-width="14" class="s${colorModelo(modelo)}" stroke-dasharray="${n1(largo)} ${n1(circ)}" stroke-dashoffset="${n1(-off)}"/>`
      off += (usd / total) * circ
    }
    c += `</g>`
  } else {
    c += `<circle cx="${cx}" cy="${n1(cy)}" r="${r}" fill="none" stroke-width="14" class="g"/>`
  }
  c += texto(cx, cy - 2, d.rango === 'hoy' ? 'hoy' : `${d.rango} días`, 'm', 11, 400, 'middle')
  c += texto(cx, cy + 13, total >= 100 ? `$${Math.round(total)}` : dinero(total), 't', 14, 600, 'middle')
  const lx = 130
  c += texto(lx, y + 14, 'Por modelo', 't', 13, 600)
  const visibles = filas.slice(0, 4)
  if (visibles.length === 0) c += texto(lx, y + 38, 'Sin gasto en este periodo', 'm', 12)
  visibles.forEach(([modelo, usd], i) => {
    const ly = y + 38 + i * 21
    c += `<rect x="${lx}" y="${ly - 9}" width="10" height="10" rx="3" class="c${colorModelo(modelo)}"/>`
    c += texto(lx + 18, ly, recorta(modelo, 18), 't', 13)
    c += texto(W - 64, ly, `${Math.round((usd / total) * 100)} %`, 'm', 13, 400, 'end')
    c += texto(W, ly, dinero(usd), 't', 13, 400, 'end')
  })
  y += 132

  // 4. Composición del contexto de esta sesión.
  c += texto(0, y, 'Qué ocupa el contexto ahora', 't', 13, 600)
  if (d.ctxTokens !== null && d.ventana) c += texto(W, y, `${k(d.ctxTokens)} de ${k(d.ventana)}`, 'm', 12, 400, 'end')
  y += 10
  const partes = (d.contexto ?? []).filter(p => p.tokens > 0)
  if (partes.length === 0) {
    c += texto(0, y + 18, 'No disponible en esta sesión.', 'm', 12)
    y += 36
  } else {
    const orden = [...partes].sort((a, b) => b.tokens - a.tokens)
    const grupo = orden.slice(0, 4)
    const resto = orden.slice(4).reduce((t, p) => t + p.tokens, 0)
    // Lo fijo delante y los mensajes, que es lo que crece, al final de la barra.
    const lista = [...grupo.filter(p => !esMensajes(p.nombre)), ...grupo.filter(p => esMensajes(p.nombre))]
    const tramos = resto > 0 ? [...lista, { nombre: 'Otros', tokens: resto }] : lista
    const sumaT = tramos.reduce((t, p) => t + p.tokens, 0)
    const disponible = W - 2 * (tramos.length - 1)
    let x = 0
    tramos.forEach((p, i) => {
      const w = Math.max(2, (p.tokens / sumaT) * disponible)
      const clase = p.nombre === 'Otros' ? 4 : i
      c += `<rect x="${n1(x)}" y="${y + 4}" width="${n1(w)}" height="14" rx="${w > 8 ? 4 : 1}" class="c${clase}"/>`
      x += w + 2
    })
    y += 38
    tramos.forEach((p, i) => {
      const lx2 = i % 2 === 0 ? 0 : W / 2 + 8
      const ly = y + Math.floor(i / 2) * 18
      const clase = p.nombre === 'Otros' ? 4 : i
      c += `<rect x="${lx2}" y="${ly - 8}" width="8" height="8" rx="2" class="c${clase}"/>`
      c += `<text x="${lx2 + 14}" y="${ly}" font-size="12" class="t">${esc(recorta(nombreCtx(p.nombre), 20))} <tspan class="m">${k(p.tokens)}</tspan></text>`
    })
    y += Math.ceil(tramos.length / 2) * 18 + 6
  }

  // 5. Últimas sesiones, como tarjetas.
  y += 8
  c += texto(0, y, 'Últimas sesiones', 't', 13, 600)
  y += 10
  const ultimas = [...enRango].sort((a, b) => b.ultima - a.ultima).slice(0, 5)
  if (ultimas.length === 0) {
    c += texto(0, y + 18, 'Aún no hay sesiones en este periodo.', 'm', 12)
    y += 30
  }
  for (const s of ultimas) {
    const alto = 46
    c += `<rect x="0" y="${y}" width="${W}" height="${alto}" rx="8" class="card"/>`
    c += texto(10, y + 19, recorta(s.nombre || s.proyecto || 'Sesión', 40), 't', 13)
    c += texto(10, y + 36, recorta(`${cuando(s.ultima, ahora)} · ${s.modelo} · ${s.proyecto}`, 50), 'm', 11)
    const serie = d.chispas[s.id] ?? []
    if (serie.length >= 2) {
      const sx = W - 140
      const smax = Math.max(...serie, 0.0001)
      const pts = serie.map((v, i) => `${n1(sx + (i / (serie.length - 1)) * 60)},${n1(y + 32 - (v / smax) * 18)}`).join(' ')
      c += `<polyline points="${pts}" fill="none" class="s0" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    }
    c += texto(W - 10, y + 28, dinero(s.usd), 't', 13, 600, 'end')
    y += alto + 8
  }

  const H = Math.ceil(y)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${ESTILO}</style>${c}</svg>`
}

/** Lecturas de la sesión que da Claude Code (las de la barra de estado). */
export type Info = {
  modelo: string
  esfuerzo: string | null
  ctx: number | null
  ctxTokens: number | null
  ventana: number | null
  usd: number | null
  limite5h: number | null
  resets5h: number | null
}

export type Tokens = { entrada: number; salida: number; cacheLee: number; cacheEscribe: number }

export type EstadoTests = {
  estado: 'ninguno' | 'ok' | 'falla' | 'viejo'
  pasan?: number
  fallan?: number
}

/** Un turno de la sesión, para los gráficos. */
export type Turno = {
  ctx: number | null
  coste: number
  cache: number | null
  modelo: string
  compactado?: boolean
}

/** Lo que el mod cuenta turno a turno en esta sesión. */
export type Metricas = {
  nombre: string
  turnos: number
  base: number
  costesTurno: number[]
  ms: number
  tokens: Tokens
  tests: EstadoTests
  historial: Turno[]
}

/** Recomendación de modelo y esfuerzo pedida con el botón Recomendar. */
export type Consejo = {
  modelo: 'haiku' | 'sonnet' | 'opus' | 'fable'
  esfuerzo: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  motivo: string
  igual: boolean
  mismoModelo?: boolean
  costeCambio: number | null
}

export type Tema = 'ironman' | 'neutro'

/** Una sesión en el registro de gasto, que se guarda entre sesiones. */
export type Sesion = {
  id: string
  dia: string
  proyecto: string
  modelo: string
  usd: number
  ultima: number
  nombre?: string
}

declare module 'claude-code' {
  interface PluginState {
    'sevas-panel': {
      info: Info | null
      metricas: Shaped<Metricas>
      sesiones: Shaped<Sesion[]>
      oculta: boolean
      detalle: boolean
      consejo: Consejo | null
      previo: string | null
      rango: 'hoy' | '7' | '30'
      tema: Tema
    }
  }
}

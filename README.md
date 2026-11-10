# sevas-panel

Mod de Claude Code para ver y controlar el gasto sin salir de la conversación. Todo lo que
hace lo ves tú, no el modelo, así que **no gasta tokens**.

## Instalación

Necesitas [Claude Code](https://claude.com/claude-code) 2.1.275 o posterior.

**En la terminal**, dentro de una sesión de `claude`:

```
/plugin install sevas-panel --marketplace sevas2001/panel-sebas-foss
```

Responde `y` para añadir el marketplace y pulsa Enter para instalarlo en el ámbito de usuario.
Queda activo al momento y en todas las sesiones nuevas.

**Desde la shell**, sin abrir Claude:

```
claude plugin install sevas-panel --marketplace sevas2001/panel-sebas-foss
```

**En la app de escritorio** (donde `/plugin` no funciona): pulsa **+** junto al cuadro de texto →
**Plugins** → **Add marketplace** con `sevas2001/panel-sebas-foss` → **Add plugin** → `sevas-panel`.
Instalado desde la terminal con ámbito de usuario, también aparece en la app de escritorio.

Para actualizar: `claude plugin update sevas-panel` y luego `/reload-plugins`.

## Banda encima del cuadro de texto

**Compacta** (una línea): modelo y esfuerzo, % de contexto (verde, amarillo a partir del 50 %,
rojo a partir del 80 %), coste de la sesión, coste del último turno, % de caché, estado de los
tests y uso del límite de 5 horas.

**Detalle** (botón ↖↘; ↘↖ vuelve a la vista compacta): columnas con coste (último turno, media y barras de los últimos
turnos), contexto (tokens usados de la ventana), tokens (y % leído de caché, en amarillo si baja
del 70 %), tiempo de Claude (total y media por turno), límite de 5 h y tests. En la app de
escritorio se dibuja como imagen para que las columnas queden alineadas.

Botones: *Copiar* (resumen de la sesión en Markdown, para un informe o un chat), *Gasto*
(abre el panel), *↖↘ / ↘↖* (detalle / compacta) y *Ocultar* (`/banda` la vuelve a mostrar). Si otro mod
también dibuja en esa zona, la suya queda debajo de la nuestra.

## Avisos

- **Contexto**, en tres niveles pensados para ventanas de 1M: 200K (20 %, buen momento si acabas de terminar algo), 500K (50 %) y unos 100K antes de la autocompactación (~867K por defecto). Si `autoCompactWindow` o `CLAUDE_CODE_AUTO_COMPACT_WINDOW` cambian la autocompactación, el aviso urgente se mueve con ella y se quitan los que caerían después. Lo guardado con `/autocompact` no se puede leer desde un mod.
- **Modelo** al enviar un mensaje: si pides una migración, un refactor, una arquitectura o una
  investigación en Sonnet o Haiku, sugiere subir; si estás en Fable con una petición corta,
  sugiere bajar a Opus. Solo avisa; nunca cambia el modelo.

## Tests

Muestra "✓ N pasan" o "✗ N fallan" tras ejecutar los tests, y "sin tests desde el último
cambio" si se edita código después. En la fila de los tests filtrados por el hook del plugin
`elegir-modelo` añade "Salida de tests filtrada: 208 → 5 líneas".

## Panel de gasto (`/gasto`)

Hoy, últimos 7 días, por día, por modelo, por proyecto y las últimas sesiones con su nombre
(el primer mensaje). Solo cuenta las sesiones con el mod activo; el coste es el que estima
Claude Code a precio de lista.

Funciona en la app de escritorio, en la terminal, en VS Code y en el móvil. Ideas de diseño
(modo detalle en SVG, coste por turno, estado de los tests, copiar en Markdown) tomadas del mod
de [Ponytail](https://github.com/DietrichGebert/ponytail).

## Recomendar modelo y esfuerzo

El botón *Recomendar* lee lo que tienes escrito en el cuadro de texto (o, si está vacío, tu
último mensaje) y hace una consulta corta a Haiku con la tabla de la skill `elegir-modelo`.
Muestra el modelo y el esfuerzo recomendados, el motivo y, si implica cambiar de modelo, lo que
cuesta reescribir la caché con el contexto actual. *Aplicar esfuerzo* ejecuta `/effort`. El **modelo hay que cambiarlo a mano en el selector de la app**: un `/model` escrito o lanzado por el mod no actualiza ese selector y la app puede volver al anterior.
Es lo único del mod que gasta tokens: unos cientos de Haiku por pulsación.

## Más ayudas de ahorro

- En el detalle, el contexto indica cuánto cuesta cada turno solo por releerlo ("≈$0.07/turno").
- Botón *Compactar…*: siempre en el detalle, y en la compacta desde 200K (desde 500K, en un recuadro rojo con ⚠ para que no pase desapercibido). Prepara un `/compact Conserva: …` con lo que conviene conservar (tarea en curso, decisiones vigentes, archivos y nombres exactos, pendiente, lo que no se toca e instrucciones del principio), lo deja en el cuadro de texto sin enviarlo y avisa si hay una tarea a medias o si conviene más `/clear`. Lo genera una consulta aparte sobre la conversación (`$.model.fork`), que no aparece en el chat.
- Aviso cuando un turno apenas lee de caché (algo la ha invalidado).

## Colores

`/banda ironman` (rojo y oro, por defecto) o `/banda neutro`.

## Mejorar el prompt

*Mejorar* lee lo que tienes escrito en el cuadro de texto y lo reescribe siguiendo la guía oficial de prompting del modelo de la sesión (Haiku 5.5, Sonnet 5.5, Opus 5.5 o Fable 5.2), resumida en `hooks/guias.ts`. La reescritura la hace Sonnet con esfuerzo bajo (céntimos). No envía nada: deja el texto en el cuadro para que lo revises, y *Deshacer* recupera tu borrador. Las reglas se basan en las páginas `prompting-claude-<modelo>` de platform.claude.com (noviembre de 2026); revísalas cuando salgan modelos nuevos.

*Mejorar+* hace lo mismo pero teniendo en cuenta lo hablado en el chat: lanza una consulta aparte sobre la conversación de la sesión (`$.model.fork`, mismo modelo, sin herramientas y sin aparecer en el chat), así puede sustituir "lo de antes" por el nombre exacto y respetar las decisiones ya tomadas. Al terminar, el aviso dice qué tomó de la conversación. Usa la caché de la conversación, así que normalmente cuesta poco; si la caché ha caducado (pausa larga o cambio de modelo reciente) paga la conversación entera a precio completo.

## Licencia

MIT. Ver [LICENSE](LICENSE).

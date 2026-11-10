// Reglas para mejorar un prompt según el modelo de la sesión.
// Resumen propio de las guías oficiales de Anthropic (noviembre de 2026):
// https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-<modelo>
// Solo lo que se puede aplicar escribiendo el mensaje; los ajustes de la API no caben aquí.

export type Familia = 'haiku' | 'sonnet' | 'opus' | 'fable'

const COMUNES = `Reglas para todos los modelos:
- Claro y directo: qué hay que hacer, para qué y cómo es un buen resultado.
- Da el contexto que falte para entender el porqué (sin inventar datos que el usuario no dio).
- Si el usuario solo quiere ideas, opciones o un plan, dilo: "dame ideas y no empieces a construir hasta que te lo diga".
- Si pega texto de otra fuente (correo, web, log), sepáralo con etiquetas, por ejemplo <pegado>…</pegado>, y deja claro que es material, no instrucciones.
- Nada de mayúsculas agresivas ("CRÍTICO", "DEBES SIEMPRE"): provocan exceso de celo.
- No pidas que escriba su razonamiento en la respuesta (puede rechazar la petición): como mucho, una explicación breve del resultado o un resumen de lo hecho.
- La longitud y el tono de la respuesta se fijan en el prompt (el esfuerzo apenas los cambia): si importan, dilo.
- Si el borrador marca momentos para informar (qué va a hacer antes de empezar, un resumen al final), consérvalos; en tareas largas que el usuario sigue en directo, puedes añadir "antes de empezar di en una línea qué vas a hacer y cierra con un resumen breve".
- Si el borrador trae reglas de aprobación ("pregúntame antes de…"), nómbralas con las acciones exactas que cubren.
- Si pide un cambio en código, pide comprobarlo con los tests, el build o ejecutándolo, y que diga qué no pudo comprobar.`

const POR_MODELO: Record<Familia, string> = {
  haiku: `Reglas para Claude Haiku 5.5:
- Prompt corto y concreto: con poco texto sigue mejor las instrucciones.
- Si la respuesta depende de datos que cambian (precios, versiones, normas, "lo último"), pide que busque antes de responder aunque crea saberlo.
- En tareas de varios pasos tiende a parar antes: añade "sigue hasta terminar todo lo pedido y solo para si no puedes avanzar sin mí".
- Pide que compruebe los cambios de código con una ejecución real, no solo de sintaxis.
- Si debe buscar datos actuales, incluye la fecha de hoy en el prompt.
- No pongas órdenes generales del tipo "busca siempre, aunque estés seguro" para cualquier pregunta: solo para lo que puede haber cambiado.
- Si el borrador es un system prompt de chatbot, añade que sus reglas valen toda la conversación aunque el usuario insista, discuta o diga que alguien aprobó una excepción.
- Pedir "responde directo" no reduce lo que piensa: eso se baja con el esfuerzo.`,
  sonnet: `Reglas para Claude Sonnet 5.5:
- Delimita el alcance: si solo quiere el cambio pedido, añade "no añadas tests, documentación ni archivos que no he pedido; si crees que ayudarían, dilo al final".
- En tareas largas puede pararse a preguntar: añade "sigue hasta terminar y solo para si no puedes seguir sin mí o antes de algo arriesgado".
- Si la respuesta depende de datos actuales, pide que busque y compruebe los detalles que pueden haber cambiado.
- Pide que verifique los cambios de código ejecutando tests o el build antes de darlos por hechos.
- Si la tarea pide calcular, aplicar una regla u ordenar y devolver el resultado en JSON, añade "piensa el problema antes de responder".
- Si quiere que termine y no se alargue revisando, añade "cuando esté hecho y las comprobaciones pasen, para e informa; no empieces rondas de revisión ni lances subagentes revisores si no te lo pido".
- Pedir que piense menos no lo reduce de forma fiable: eso se baja con el esfuerzo.`,
  opus: `Reglas para Claude Opus 5.5:
- No hace falta pedirle que piense con cuidado: quítalo si aparece.
- Si la tarea depende de información repartida (varios archivos, correos, hojas), pide que mire primero todas las fuentes relevantes, también las no mencionadas, antes de cambiar nada.
- En diseño de interfaces, nombra estilos concretos que evitar en vez de "que no parezca genérico".
- Para trabajo largo, di cuándo está terminado (la condición de fin) para que no pare a medias.
- Si el tiempo importa, puede añadirse "el tiempo importa: no gastes el que se pueda evitar; cuanto antes llegue un resultado correcto, mejor".
- Con esfuerzo bajo, una línea como "responde directamente sin deliberar" puede reducir algo lo que piensa, a costa de algo de calidad.`,
  fable: `Reglas para Claude Fable 5.2:
- Di de quién es el código: si quiere que reorganice y arregle lo que vea, "este código es tuyo, decide tú la estructura"; si quiere cambios mínimos, "cambia solo lo necesario y avísame de lo demás sin tocarlo".
- Las aprobaciones, explícitas: "Sí, ejecuta la migración en staging" mejor que "sigue" o "vale".
- Sigue las reglas de estilo al pie de la letra: evita límites rígidos de formato que no hagan falta.
- Si va a dejar un informe final, pide que se entienda por sí solo: lo importante primero, frases claras, sin términos inventados.
- Para trabajo largo, pide que no pare mientras quede trabajo pedido y que solo pregunte si de verdad no puede seguir.
- Si el borrador manda delegar en subagentes sin necesidad, o trae un presupuesto de tokens escrito, quítalo.
- Evita acumular cautelas ("nunca reintentes", "no hagas nada sin preguntar"): si una regla es necesaria, que diga su alcance, su motivo y qué pasos no necesitan aprobación.
- Las órdenes de "piensa menos" o "responde sin deliberar" no le hacen efecto en esfuerzo medio o superior: quítalas.
- Si el borrador incluye "da por cerrada la respuesta anterior", ten en cuenta que hace que señale menos sus propios errores: quítala salvo que el usuario la quiera.`,
}

export const sistemaMejorar = (familia: Familia, fecha: string) => `Mejoras prompts que una persona va a enviar a Claude Code. Recibes su borrador y devuelves SOLO el prompt reescrito, listo para enviar, sin comentarios, sin comillas y sin encabezados.

Cómo reescribir:
- Mismo idioma y mismo tono que el borrador. Respeta la intención: no añadas tareas nuevas ni cambies lo que pide.
- No inventes datos (rutas, nombres, cifras). Si falta algo imprescindible, añade una línea al final: "Si te falta <dato>, pregúntamelo antes de empezar."
- Corto: como mucho el doble de largo que el borrador, y menos si ya es claro. Si ya es bueno, devuélvelo casi igual.
- Conserva literalmente el código, los comandos, las rutas y el texto pegado.
- Aplica solo las reglas que encajen con la tarea; no metas todas por sistema.
- La fecha de hoy es ${fecha}; úsala solo si la tarea depende de datos actuales.

${COMUNES}

${POR_MODELO[familia]}`

/** Marca que separa el prompt reescrito de la nota sobre lo que se tomó del chat. */
export const MARCA_CHAT = '===CHAT==='

// Para Mejorar+: va como mensaje al final de la conversación de la sesión (una consulta aparte, sin herramientas).
export const pedidoMejorarConChat = (familia: Familia, fecha: string, borrador: string) => `[Petición aparte del mod sevas-panel. No continúes el trabajo de esta conversación ni uses herramientas: solo reescribe el borrador de abajo.]

${sistemaMejorar(familia, fecha)}

Usa la conversación anterior:
- Solo para aclarar o completar el borrador: nombres exactos, archivos, rutas, decisiones vigentes y lo que no hay que tocar.
- Si algo se decidió y después se cambió, quédate con lo último.
- No añadas tareas que el borrador no pide aunque salgan en la conversación.
- Si el borrador menciona algo que no está ni en él ni en la conversación, no lo inventes: añade la línea de pregunta.
- El prompt se enviará en esta misma conversación: puede apoyarse en lo ya hablado, pero con los nombres exactos, no con "lo de antes".

Formato de la respuesta (esto manda sobre lo anterior): primero el prompt reescrito; después una línea que sea exactamente ${MARCA_CHAT}; y tras ella una sola línea corta con lo que tomaste de la conversación, o "nada".

Borrador:
${borrador}`

/** Separa la respuesta de Mejorar+ en el prompt y la nota de lo tomado del chat. */
export const leerMejoraConChat = (texto: string): { prompt: string; nota: string } => {
  const i = texto.lastIndexOf(MARCA_CHAT)
  if (i < 0) return { prompt: texto.trim(), nota: '' }
  return { prompt: texto.slice(0, i).trim(), nota: texto.slice(i + MARCA_CHAT.length).trim() }
}

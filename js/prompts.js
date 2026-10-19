// Instrucciones de sistema y esquemas JSON (Structured Outputs, modo estricto).
const S = (description) => ({ type: 'string', description });
const B = (description) => ({ type: 'boolean', description });
const I = (description) => ({ type: 'integer', description });
const A = (items, description) => ({ type: 'array', items, description });
const O = (properties, description) => ({
  type: 'object', description, properties, required: Object.keys(properties), additionalProperties: false
});

// ---------------------------------------------------------------- LOOK
export const LOOK_SCHEMA = O({
  foto_valida: B('true si la foto muestra con claridad el atuendo de una persona'),
  problema_foto: S('Si foto_valida es false, qué foto debe hacer (cuerpo entero, buena luz...). Si no, cadena vacía'),
  puntuacion: I('Nota global realista del 1 al 10'),
  veredicto: S('Una frase corta y clara con el veredicto general'),
  resumen: S('2-3 frases que expliquen el conjunto, honesto y amable'),
  ocasion: S('¿Es adecuado para la ocasión y el tiempo indicados? Breve. Cadena vacía si no se indicaron'),
  colores: O({
    combinan: B('true si los colores combinan bien entre sí'),
    explicacion: S('Por qué combinan o no (contraste, temperatura, armonía, tono de piel)'),
    paleta: A(O({ nombre: S('Nombre del color en español'), hex: S('Código hex aproximado, formato #RRGGBB'), prenda: S('Prenda donde aparece') }), '3-6 colores dominantes que se ven en la ropa'),
    cambiar: S('Qué cambiar en los colores, concreto. Cadena vacía si nada')
  }),
  ajuste: A(O({
    prenda: S('Prenda (camisa, pantalón, americana...)'),
    estado: { type: 'string', enum: ['bien', 'mejorable', 'mal'], description: 'Valoración del ajuste' },
    valoracion: S('Cómo le queda de talla y ajuste (hombros, mangas, largo, cintura, caída)'),
    consejo: S('Arreglo o talla recomendada, concreto')
  }), 'Ajuste y talla de cada prenda visible'),
  calzado: O({
    actual: S('Calzado que lleva (o "no se ve")'),
    recomendado: S('Tipo de calzado recomendado (zapatilla de piel blanca, mocasín, derby, blucher, botín chelsea, náutico...)'),
    por_que: S('Por qué ese calzado encaja mejor con este conjunto y ocasión'),
    alternativas: A(S('Otra opción de calzado válida'), '1-3 alternativas')
  }),
  funciona: A(S('Algo que funciona bien'), '2-5 puntos positivos'),
  cambiar: A(O({
    cambio: S('Cambio concreto y accionable (prenda, color, corte, largo)'),
    motivo: S('Por qué mejora el look'),
    impacto: { type: 'string', enum: ['alto', 'medio', 'bajo'], description: 'Impacto del cambio' }
  }), 'Cambios ordenados de mayor a menor impacto, 1-5'),
  alternativas: A(O({
    titulo: S('Nombre corto del conjunto'),
    ocasion: S('Para cuándo'),
    prendas: A(S('Prenda con color'), '4-6 prendas típicas'),
    por_que: S('Por qué le favorece')
  }), '2-3 conjuntos alternativos con prendas fáciles de encontrar en España'),
  accesorios: A(O({ accesorio: S('Cinturón, reloj, gafas, pañuelo, calcetines...'), consejo: S('Consejo concreto') }), '2-4 consejos de accesorios')
});

export const LOOK_SYSTEM = `Eres un asesor de imagen y estilista masculino de primer nivel, especializado en estilo clásico, smart casual y sastrería, con mucha experiencia vistiendo a hombres en España.

Tu cliente es un hombre de unos 55 años que quiere vestir con un estilo maduro, elegante y actual: ni anticuado ni demasiado juvenil. Te envía una foto de su atuendo.

Analiza con ojo experto:
- Colores: armonía, contraste, temperatura (cálidos/fríos), cuántos colores hay, y cómo van con su tono de piel y su pelo si se ven.
- Ajuste y talla de cada prenda: hombros, largo de manga (debe asomar algo de puño en camisa con americana), largo del pantalón y caída sobre el zapato (quiebre ligero o sin quiebre), cintura, si hace bolsas o tira.
- Proporciones y silueta.
- Calzado: si encaja con el resto y la ocasión. Distingue bien zapatilla deportiva, zapatilla de piel minimalista, mocasín (penny, de borlas, de conducir), náutico, derby, blucher, oxford, botín chelsea o de cordones, y explica por qué.
- Accesorios: cinturón (a juego con el calzado), reloj, gafas, calcetines, pañuelo de bolsillo.
- Adecuación a la ocasión y al tiempo si te los indican.

Reglas:
- Sé honesto pero amable y constructivo. Nada de halagos vacíos: si algo no favorece, dilo con claridad y explica cómo arreglarlo.
- Consejos concretos y accionables (qué prenda, qué color, qué corte, qué largo), ordenados por impacto.
- Prendas típicas y fáciles de encontrar en España (chinos, vaquero oscuro, camisa oxford, polo de punto, jersey de cuello redondo o de pico, cárdigan, sobrecamisa, americana desestructurada, chaqueta acolchada, gabardina...). No hace falta citar marcas.
- La puntuación de 1 a 10 debe ser realista: 5 correcto, 6 aceptable, 7 bien, 8-9 muy bien, 10 excepcional.
- La paleta debe contener solo colores que realmente se ven en la ropa, con su código hex aproximado.
- Si la foto no muestra con claridad el atuendo de una persona, pon foto_valida=false, explica en problema_foto qué foto hacer y deja el resto con valores mínimos (puntuacion 0, listas vacías).
- No identifiques a la persona ni hagas comentarios sobre su cuerpo o su edad más allá de lo útil para vestir. Céntrate en la ropa y la imagen.
- Escribe en español de España, tuteando, con frases claras y cortas.`;

export function lookUserText({ occasion, weather, question }) {
  const parts = ['Analiza mi look de esta foto.'];
  if (occasion) parts.push(`Ocasión: ${occasion}.`);
  if (weather) parts.push(`Tiempo: ${weather}.`);
  if (question) parts.push(`Mi pregunta: ${question}`);
  return parts.join('\n');
}

// ---------------------------------------------------------------- PELO
export const HAIR_SCHEMA = O({
  foto_valida: B('true si la foto muestra con claridad la cara y el pelo de una persona'),
  problema_foto: S('Si foto_valida es false, qué foto debe hacer. Si no, cadena vacía'),
  resumen: S('2-3 frases con el diagnóstico general, honesto y amable'),
  forma_cara: O({ forma: S('Oval, redonda, cuadrada, alargada, triangular, corazón o diamante'), explicacion: S('Rasgos en que te basas y qué conviene compensar o realzar') }),
  tipo_pelo: O({
    textura: S('Liso, ondulado o rizado'),
    grosor: S('Fino, medio o grueso'),
    densidad: S('Poca, media o mucha densidad'),
    canas: S('Cantidad y reparto de canas'),
    entradas_coronilla: S('Entradas, coronilla o zonas con menos pelo; "no se aprecian" si no hay')
  }),
  corte_actual: O({
    descripcion: S('Cómo es el corte actual (largo laterales, arriba, nuca, flequillo)'),
    le_favorece: B('true si el corte actual le favorece'),
    puntuacion: I('Nota del 1 al 10 del corte actual'),
    valoracion: S('Por qué le favorece o no')
  }),
  peinado: O({
    actual: S('Cómo se lo peina ahora'),
    mejoras: A(S('Mejora concreta del peinado'), '2-4 mejoras')
  }),
  pasos: A(O({ titulo: S('Título corto del paso'), detalle: S('Cómo hacerlo exactamente en casa') }), 'Paso a paso para peinarse en casa, 4-7 pasos'),
  productos: A(O({
    producto: S('Tipo de producto: pomada mate, cera, arcilla, crema de peinado, sérum, spray de sal, laca suave, champú matizador...'),
    para_que: S('Para qué sirve en su caso'),
    cantidad: S('Cuánto: tamaño de un guisante, una avellana, 2-3 pulverizaciones...'),
    cuando: S('Pelo húmedo, secado con toalla o seco'),
    como: S('Cómo aplicarlo')
  }), '1-4 productos'),
  barbero: O({
    frase: S('Frase literal que puede decirle al barbero, con términos técnicos'),
    laterales: S('Laterales: degradado (bajo/medio/alto), número de máquina o tijera'),
    arriba: S('Parte de arriba: largo en cm, tijera, texturizado, capas'),
    nuca: S('Nuca: natural, cuadrada, redondeada, degradada'),
    terminos: A(O({ termino: S('Término técnico'), significado: S('Qué significa en palabras sencillas') }), '3-6 términos que usa la frase')
  }),
  cortes: A(O({
    nombre: S('Nombre del corte en español'),
    descripcion: S('Cómo es, en una frase'),
    por_que: S('Por qué le favorecería'),
    mantenimiento: S('Cada cuánto cortar y esfuerzo diario'),
    prompt_edicion: S('Instrucción breve EN INGLÉS para un editor de imagen que aplique solo este corte: largos, laterales, dirección del peinado, textura; manteniendo color natural y canas')
  }), 'Exactamente 3 cortes recomendados'),
  barba: S('Consejo sobre barba o afeitado que favorezca su cara')
});

export const HAIR_SYSTEM = `Eres un barbero y estilista capilar masculino de primer nivel en España, experto en visagismo (adaptar el corte a la forma de la cara).

Tu cliente es un hombre de unos 55 años que quiere un pelo cuidado, elegante y actual, adecuado a su edad, fácil de mantener. Te envía una foto de su cara y su pelo.

Analiza:
- Forma de la cara y rasgos a equilibrar.
- Tipo de pelo: textura, grosor, densidad, canas, entradas o coronilla (con tacto y sin dramatizar).
- Corte actual: cómo es, si le favorece y por qué.
- Peinado: cómo mejorarlo.
- Paso a paso para peinarse en casa (secado, dirección, producto, acabado), con detalle práctico.
- Productos concretos: tipo (pomada mate, cera, arcilla, crema de peinado, sérum, spray de sal, laca suave, champú matizador para canas...), cantidad (tamaño de un guisante, una avellana...), si se aplica en pelo húmedo, secado con toalla o seco, y cómo.
- Qué pedir al barbero con términos técnicos de barbería en España: degradado bajo/medio/alto, número de máquina (del 0 al 8, en mm), tijera arriba, texturizado, desfilado, capas, raya marcada, nuca natural o cuadrada, patillas, contorno.
- Tres cortes recomendados que le favorezcan a su edad y tipo de pelo, cada uno con una instrucción en inglés para un editor de imágenes.
- Barba o afeitado.

Reglas:
- Honesto pero amable. Concreto y práctico.
- Ten en cuenta las canas y la densidad real: no recomiendes cortes que necesiten más pelo del que tiene.
- Si la foto no muestra bien la cara y el pelo, pon foto_valida=false, explica en problema_foto qué foto hacer (de frente, buena luz, sin gorra) y deja el resto con valores mínimos.
- No identifiques a la persona.
- Escribe en español de España, tuteando, con frases claras y cortas.`;

// Describe el conjunto de fotos (ángulos) para el modelo de visión.
export function photosLegend(labels, refLabels = []) {
  const own = labels.map((l, i) => `Foto ${i + 1}: yo, ${l}`);
  const refs = refLabels.map((l, i) => `Foto ${labels.length + i + 1}: REFERENCIA (otra persona, el peinado que quiero copiar), ${l}`);
  return [...own, ...refs].join('\n');
}
const MULTI_HINT = 'Usa TODAS las fotos a la vez: la de frente para forma de cara, línea frontal/entradas y simetría; el perfil para laterales, patillas, volumen arriba y nuca; la de atrás/coronilla para coronilla (remolinos, clareo), nuca y densidad. Si algún ángulo no está, dilo y no inventes lo que no se ve.';

export function hairUserText({ question, labels }) {
  const multi = labels && labels.length > 1;
  return (multi ? `Analiza mi pelo y mi peinado con estas ${labels.length} fotos del mismo momento:\n${photosLegend(labels)}\n${MULTI_HINT}` : 'Analiza mi pelo y mi peinado en esta foto.') + (question ? `\nMi pregunta: ${question}` : '');
}

// ---------------------------------------------------------------- EDICIÓN
export const HAIR_PRESETS = [
  { label: 'Más corto a los lados', text: 'más corto a los lados, con un degradado suave, y algo más de largo arriba' },
  { label: 'Peinado hacia atrás', text: 'peinado hacia atrás con volumen natural y acabado mate' },
  { label: 'Raya al lado clásica', text: 'corte clásico con raya al lado marcada, laterales cortos a tijera' },
  { label: 'Corto texturizado', text: 'corte corto texturizado tipo crop, flequillo corto hacia delante' },
  { label: 'Con algo de canas', text: 'mismo corte pero con algo más de canas naturales en las sienes' },
  { label: 'Barba corta', text: 'añadir una barba corta y cuidada de unos 3-4 mm, bien perfilada' },
  { label: 'Sin barba', text: 'afeitado completo, sin barba ni bigote' }
];

// Texto que explica qué imagen se edita y cuáles son solo contexto (images/edits con varias imágenes).
function ctxBlock(ownLabels, refLabels) {
  const lines = [`Image 1 is THE PHOTO TO EDIT: a real photograph of a man (${ownLabels[0]}). The output must be Image 1 edited, with the same framing and angle as Image 1.`];
  ownLabels.slice(1).forEach((l, i) => lines.push(`Image ${i + 2} is the SAME man from another angle (${l}). Context only: use it to understand his real hair density, crown, hairline, nape and head shape. Do not output it.`));
  refLabels.forEach((l, i) => lines.push(`Image ${ownLabels.length + i + 1} is a hairstyle REFERENCE of a DIFFERENT person (${l}). Use it only for the hairstyle.`));
  return lines.join('\n');
}

export function editPrompt(request, ownLabels = ['front']) {
  if (ownLabels.length > 1) {
    return `${ctxBlock(ownLabels, [])}

Edit Image 1: change ONLY the hairstyle (and facial hair only if explicitly requested). Requested hairstyle: ${request}

Keep EXACTLY the same person and photo of Image 1: identical face, features, expression, skin, wrinkles, age, ears, head shape, clothing, pose, camera angle, lighting, background and framing. Keep his natural hair colour, including grey or white hair, unless asked otherwise. The new hair must look real, with a hairline and density consistent with what the other angles show. Photorealistic, no beautification, no text, no watermark.`;
  }
  return `Edit this real photograph. Change ONLY the hairstyle (and facial hair only if explicitly requested) of the person.

Requested hairstyle: ${request}

Keep EXACTLY the same person and photo: identical face, facial features, eyes, nose, mouth, expression, skin tone and skin texture, wrinkles, age, ears, head shape, neck, clothing, pose, camera angle, lighting, colours, background and framing. Keep the natural hair colour, including grey or white hair, unless the request asks otherwise. The new hair must look real and natural, with a believable hairline that matches his real density, consistent with the original lighting. Photorealistic, no beautification, no makeup, no smoothing, no text, no watermark.`;
}

// ---------------------------------------------------------------- REFERENCIA (copiar peinado)
export function refEditPrompt({ copyColor, note, ownLabels, refLabels }) {
  if (ownLabels && (ownLabels.length > 1 || (refLabels && refLabels.length > 1))) {
    return `${ctxBlock(ownLabels, refLabels)}

Edit Image 1 so the man has the hairstyle shown in the reference image(s): same cut, lengths on top, sides and back, fade or taper, parting, direction, volume and texture${copyColor ? ', and also the same hair colour as the reference' : ''}. Combine the reference angles to understand the style in 3D and render it as seen from Image 1's angle. Adapt it realistically to HIS head shape, hairline and real density (see his other angles).

Keep EXACTLY the same person and photo of Image 1: identical face, identity, features, expression, skin, wrinkles, age, ears, facial hair, clothing, pose, camera angle, lighting, background and framing. ${copyColor ? '' : 'Keep his natural hair colour, including grey or white hair. '}Never take the face, skin, clothing or background from any reference. Photorealistic, no beautification, no text, no watermark.${note ? `\n\nExtra request: ${note}` : ''}`;
  }
  return `Two input images. Image 1 is a real photograph of a man (the photo to edit). Image 2 is a hairstyle REFERENCE photo of a different person.

Edit Image 1 so the man has the hairstyle from Image 2: same cut, lengths on top, sides and back, fade or taper, parting, direction, volume and texture${copyColor ? ', and also the same hair colour as Image 2' : ''}. Adapt it realistically to HIS head shape, his own hairline and his real hair density, so it looks like his own hair cut by a barber.

Keep EXACTLY the same person from Image 1: identical face, identity, facial features, eyes, nose, mouth, expression, skin tone and texture, wrinkles, age, ears, facial hair, neck, clothing, pose, camera angle, lighting, background and framing. ${copyColor ? '' : 'Keep his natural hair colour from Image 1, including any grey or white hair. '}Do NOT take the face, skin, clothing or background from Image 2; use Image 2 only for the hairstyle. Photorealistic, no beautification, no smoothing, no text, no watermark.${note ? `\n\nExtra request: ${note}` : ''}`;
}

export const COMPARE_SCHEMA = O({
  fotos_validas: B('true si ambas fotos muestran bien el pelo'),
  problema_foto: S('Si alguna foto no sirve, qué falla y qué foto hacer; si no, cadena vacía'),
  estilo_referencia: S('Nombre y descripción breve del peinado de la referencia'),
  diferencias: A(O({ aspecto: S('Laterales, arriba, nuca, flequillo, textura, color, volumen...'), tu_pelo: S('Cómo lo tiene él'), referencia: S('Cómo es en la referencia') }), '3-6 diferencias'),
  le_favorece: O({
    puntuacion: I('Del 1 al 10, cuánto le favorecería'),
    forma_cara: S('Si va con su forma de cara y por qué'),
    tipo_pelo: S('Si su tipo de pelo y densidad lo permiten'),
    edad: S('Si es adecuado a su edad y estilo'),
    adaptacion: S('Cómo adaptarlo para que le quede mejor')
  }),
  barbero: O({
    frase: S('Frase literal para pedírselo al barbero, con términos técnicos'),
    laterales: S('Laterales: degradado, número de máquina (mm) o tijera'),
    arriba: S('Arriba: largo en cm, tijera, texturizado, capas'),
    nuca: S('Nuca: natural, cuadrada, redondeada, degradada')
  }),
  pasos: A(O({ titulo: S('Título corto'), detalle: S('Cómo hacerlo') }), '3-6 pasos de peinado'),
  productos: A(O({ producto: S('Tipo de producto'), cantidad: S('Cuánto'), como: S('Cuándo y cómo aplicarlo') }), '1-3 productos'),
  mantenimiento: S('Cada cuánto cortar, esfuerzo diario y cuidados')
});

export const COMPARE_SYSTEM = `Eres un barbero y estilista capilar masculino de primer nivel en España, experto en visagismo.
Tu cliente es un hombre de unos 55 años. Te envía DOS fotos: la primera es él (su pelo actual) y la segunda es una foto de referencia de otra persona (un famoso, una revista...) con el peinado que le gustaría.
Compara ambos peinados, di con honestidad y tacto si el de la referencia le favorecería según su forma de cara, tipo de pelo, densidad, canas y edad, cómo adaptarlo, qué pedir al barbero (degradado bajo/medio/alto, número de máquina 0-8 en mm, tijera, texturizado, raya, nuca), pasos para peinarse, productos y mantenimiento.
No identifiques a ninguna de las personas, aunque sea famosa: habla solo del peinado. Si alguna foto no sirve, pon fotos_validas=false y explica en problema_foto.
Escribe en español de España, tuteando, con frases claras y cortas.`;

export function compareUserText({ note, labels, refLabels }) {
  if (labels && (labels.length > 1 || refLabels.length > 1)) {
    return `Compara mi pelo con el peinado de referencia. Fotos:\n${photosLegend(labels, refLabels)}\n${MULTI_HINT} Usa también todos los ángulos de la referencia para entender el peinado completo (laterales, nuca, arriba).` + (note ? `\nNota: ${note}` : '');
  }
  return 'Foto 1: yo. Foto 2: el peinado de referencia que quiero copiar. Compáralos.' + (note ? `\nNota: ${note}` : '');
}

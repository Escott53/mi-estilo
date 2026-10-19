# Mi Estilo

Asesor de imagen personal (PWA, en español): analiza tu **look**, tu **pelo** y te deja **probar peinados** con IA.

- 100 % estática (HTML/CSS/JS), sin servidor propio. Llama directamente a la API de OpenAI desde el móvil.
- La clave de OpenAI la pega el usuario en *Ajustes*; se guarda cifrada (AES-GCM con una clave de dispositivo no extraíble) solo en IndexedDB del móvil.
- Las fotos solo salen del móvil al pulsar *Analizar* o *Generar* (y se envían con `store: false`).
- Historial local (IndexedDB), contador de uso mensual y coste aproximado.

Modelos por defecto (configurables en Ajustes): `gpt-5.4` para analizar (alternativa `gpt-5-mini`) y `gpt-image-2` para editar (alternativa `gpt-image-1-mini`).

## Varias fotos (v1.2.0)

Mi pelo y Probar peinado admiten hasta 5 fotos propias (Frente, Perfil, Atrás/Coronilla + extras; se pueden elegir varias de la galería) y hasta 3 de referencia. El análisis y la comparación envían todas las fotos con su ángulo. Al generar se retoca solo la foto ★ principal; las demás y las referencias van como contexto (a 1024 px). Opción “Generar también el perfil” (otra imagen, otro coste).

## Foto de referencia (v1.1.0)
En **Probar peinado** puedes añadir una *Foto de referencia (estilo a copiar)*: un famoso o una revista.
- **✂️ Copiar este peinado**: envía tu foto + la referencia a `images/edits` (`image[]` ×2) y aplica solo el peinado, conservando tu cara, piel, ropa y fondo. Opción *Copiar también el color*.
- **🔍 Comparar con mi pelo**: análisis en español con diferencias, si te favorece, qué pedir al barbero, pasos, productos y mantenimiento.

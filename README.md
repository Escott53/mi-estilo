# Mi Estilo

Asesor de imagen personal (PWA, en español): analiza tu **look**, tu **pelo** y te deja **probar peinados** con IA.

- 100 % estática (HTML/CSS/JS), sin servidor propio. Llama directamente a la API de OpenAI desde el móvil.
- La clave de OpenAI la pega el usuario en *Ajustes*; se guarda cifrada (AES-GCM con una clave de dispositivo no extraíble) solo en IndexedDB del móvil.
- Las fotos solo salen del móvil al pulsar *Analizar* o *Generar* (y se envían con `store: false`).
- Historial local (IndexedDB), contador de uso mensual y coste aproximado.

Modelos por defecto (configurables en Ajustes): `gpt-5.4` para analizar (alternativa `gpt-5-mini`) y `gpt-image-2` para editar (alternativa `gpt-image-1-mini`).

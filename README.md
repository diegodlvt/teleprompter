# Teleprompter por voz

Teleprompter web que **avanza siguiendo tu voz** y **se detiene cuando dejas de leer**.
Funciona en iPhone (Safari o Chrome), Android y computadora, sin instalar nada desde una tienda de apps.

## Cómo se usa

1. Abre la página y pega tu guion.
2. Toca **Empezar** y permite el micrófono.
3. Lee en voz alta. La palabra resaltada en verde es la que sigue; lo ya leído queda en gris.
4. Si te callas, el texto se queda quieto. Si te saltas una frase, retoma donde sigas leyendo.
5. Toca cualquier palabra para continuar desde ahí. ⟲ vuelve al inicio, A−/A+ cambia el tamaño.

Para tenerlo como app: en Safari, **Compartir → Agregar a inicio**.

## Reconocimiento de voz

| Motor | Costo | Dónde funciona |
|---|---|---|
| Del navegador (Web Speech API) | Gratis | Safari en iPhone/Mac, Chrome en Android/PC. En Chrome para iPhone suele no estar disponible. |
| Deepgram (nube) | Menos de 1 centavo de dólar por minuto (dan crédito gratis al registrarte) | Cualquier navegador moderno, incluido Chrome en iPhone y modo pantalla de inicio. |

En **Ajustes → Reconocimiento de voz → Automático** usa el del navegador y, si falla, cambia solo a Deepgram (si pusiste una clave).
La clave de Deepgram se guarda únicamente en tu dispositivo (localStorage); no está en este repositorio.

## Problemas comunes en iPhone

- Activa **Ajustes → General → Teclado → Activar dictado** (lo necesita el motor del navegador).
- Si desde el ícono de inicio no escucha, ábrelo directo en Safari o usa Deepgram.
- Mientras la app **Cámara** graba, iOS le quita el micrófono a esta página: usa otro dispositivo para grabar.

## Cómo funciona por dentro

- `matcher.js`: compara las últimas ~10 palabras reconocidas con una ventana del guion mediante un alineamiento local difuso
  (tolera errores de reconocimiento, palabras omitidas y muletillas). La posición solo avanza cuando hay coincidencia real.
- `app.js`: interfaz, desplazamiento suave, motores de voz (Web Speech API y Deepgram por WebSocket) y ajustes.
- Sitio estático: sin servidor ni compilación. Se publica tal cual con GitHub Pages.

## Probar localmente

```bash
python3 -m http.server 8000
# abre http://localhost:8000 (el micrófono requiere localhost o HTTPS)
```

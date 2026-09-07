# MUNDI

Simulador de mundos en el navegador con física ecológica creíble y aldeas que aprenden.

## Jugar

```bash
npm install
npm run dev
```

Abre la URL de Vite (por defecto `http://localhost:5173`).

## Qué lo hace realista

- **Elevación y ríos** — el mapa guarda altura; los ríos se tallan cuesta abajo al generar el mundo
- **Temperatura local** — latitud, altitud, estación, sol y clima definen °C por celda
- **Hidrología** — la lluvia crea escorrentía, inunda valles bajos y alimenta humedad
- **Día / noche** — lobos cazan de noche, conejos se refugian, humanos descansan; el mapa se tiñe
- **Viento y tormentas** — el fuego se propaga a favor del viento; los rayos pueden prender
- **Cosecha real** — los aldeanos van a talar, minar, recolectar bayas, cazar y pescar; el stock solo sube al actuar
- **Conocimiento y tecnología** — la aldea desbloquea saberes (caza, carpintería…) y tech (herramientas, granja…) al cumplir requisitos

## Controles

- **Biomas** — pinta océano, agua, arena, hierba, bosque, montaña o nieve
- **Vida** — spawnea humanos, conejos y lobos
- **Desastres** — fuego (sigue el viento), meteorito, lluvia (apaga y encharca)
- **Capas** — alimento, humedad, fertilidad, temperatura, elevación, peligros
- **Inspector** — muestra tarea, reservas y progreso de saberes/tecnologías de la aldea
- **Rueda** — zoom
- **Espacio + arrastrar** / herramienta Mano / clic derecho — pan
- **Pincel / Velocidad / Pausa / Mis mundos** — barra inferior

## Stack

Vite + TypeScript + Canvas 2D

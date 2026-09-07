# MUNDI

Simulador de mundos en el navegador: motor dios-juego con emergencia sistémica (clima, logística, diplomacia, dinastías y profecías).

## Jugar

```bash
npm install
npm run dev
```

Abre la URL de Vite (por defecto `http://localhost:5173`).

## Arquitectura del motor

- **Simulación pura vs presentación** — `simulate()` + `SimulationEngine` corren headless/fast-forward sin el renderer
- **Capas de rejilla** — terreno, humedad, temperatura, vegetación, elevación/recursos + autómatas (agua, fuego, estaciones)
- **Facciones y casus belli** — hostilidad emergente por escasez, fronteras, cultura y religión
- **Logística física** — rutas A* y caravanas; un corte de ruta provoca déficit
- **Dinastías** — gobernantes, herederos, sucesión y alianzas por matrimonio
- **Cultura** — creencias que mutan con incendios, hambrunas, guerras y cataclismos
- **Utility AI** — gobernantes eligen políticas; aldeanos usan colas de trabajo/FSM
- **Herramientas divinas** — pinceles de calor/humedad/altura/fertilidad sobre el estado simulado
- **Profecías** — motor `IF [condición] THEN [acción]`
- **Debug** — capas de coste de ruta e influencia política

Verificación headless:

```bash
npm run verify:engine
```

## Controles

- **Terreno / Fuerzas / Vida / Poderes** — pinta biomas, capas físicas, spawns y desastres
- **Capas** — alimento, humedad, fertilidad, temperatura, elevación, peligros, coste de ruta, influencia
- **Inspector** — tarea, reservas, relaciones, creencias y progreso
- **Rueda** — zoom · **Espacio + arrastrar** — pan · **Velocidad / Pausa / Mis mundos**

## Stack

Vite + TypeScript + Canvas 2D

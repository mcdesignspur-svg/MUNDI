import type { Snapshot } from './snapshot'

export type Slot = 'slot-1' | 'slot-2' | 'slot-3' | 'auto' | 'previous'
export interface SavedWorld { slot: Slot; savedAt: number; data: Snapshot }
let connection: Promise<IDBDatabase> | undefined
function database(): Promise<IDBDatabase> {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('mundi-worlds', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('worlds', { keyPath: 'slot' })
    request.onerror = () => { connection = undefined; reject(new Error('No se pudo abrir el guardado local. Puedes exportar la partida.')) }
    request.onblocked = () => { connection = undefined; reject(new Error('Cierra otras pestañas de MUNDI para abrir el guardado.')) }
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = undefined }
      resolve(request.result)
    }
  })
  return connection
}
export async function saveWorld(slot: Slot, data: Snapshot): Promise<void> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('worlds', 'readwrite')
    transaction.objectStore('worlds').put({ slot, savedAt: Date.now(), data } satisfies SavedWorld)
    transaction.oncomplete = () => resolve()
    transaction.onabort = transaction.onerror = () => reject(new Error('No se pudo guardar. Exporta tu mundo para conservarlo.'))
  })
}
export async function listWorlds(): Promise<SavedWorld[]> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = db.transaction('worlds').objectStore('worlds').getAll()
    request.onsuccess = () => resolve(request.result as SavedWorld[])
    request.onerror = () => reject(new Error('No se pudieron leer las partidas.'))
  })
}

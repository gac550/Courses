/**
 * Preload: única superficie expuesta al renderer.
 *
 * Corre con sandbox y contextIsolation activos, así que se limita a un puente
 * de mensajes tipado. No expone ipcRenderer crudo, ni Node, ni el sistema de
 * archivos: sólo los canales explícitos que la interfaz necesita.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('courses', {
  query: (filters) => ipcRenderer.invoke('courses:query', filters),
  facets: () => ipcRenderer.invoke('courses:facets'),
  stats: () => ipcRenderer.invoke('courses:stats'),
  unavailableSources: () => ipcRenderer.invoke('sources:unavailable'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  runPipeline: (options) => ipcRenderer.invoke('pipeline:run', options),

  /** Suscripción al progreso del pipeline. Devuelve la función para cancelarla. */
  onPipelineProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('pipeline:progress', listener);
    return () => ipcRenderer.removeListener('pipeline:progress', listener);
  },

  /** Aviso de que el catálogo cambió en disco: permite refrescar sin reiniciar. */
  onCatalogChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('catalog:changed', listener);
    return () => ipcRenderer.removeListener('catalog:changed', listener);
  },
});

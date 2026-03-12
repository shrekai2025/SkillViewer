import { contextBridge, ipcRenderer } from 'electron'

import type { SkillviewerApi } from '../src/shared/contracts'

const api: SkillviewerApi = {
  addSource: () => ipcRenderer.invoke('skillviewer:add-source'),
  getSnapshot: () => ipcRenderer.invoke('skillviewer:get-snapshot'),
  removeSource: (sourceId) => ipcRenderer.invoke('skillviewer:remove-source', sourceId),
  revealSkill: (filePath) => ipcRenderer.invoke('skillviewer:reveal-skill', filePath),
  saveSkill: (payload) => ipcRenderer.invoke('skillviewer:save-skill', payload),
  toggleSkill: (payload) => ipcRenderer.invoke('skillviewer:toggle-skill', payload),
}

contextBridge.exposeInMainWorld('skillviewer', api)

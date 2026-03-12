import { contextBridge, ipcRenderer } from 'electron'

import type { SkillviewerApi } from '../src/shared/contracts'

const api: SkillviewerApi = {
  addSource: () => ipcRenderer.invoke('skillviewer:add-source'),
  addMarketRegistry: (payload) => ipcRenderer.invoke('skillviewer:add-market-registry', payload),
  browseMarketSkills: (payload) => ipcRenderer.invoke('skillviewer:browse-market-skills', payload),
  checkSkillUpdates: () => ipcRenderer.invoke('skillviewer:check-skill-updates'),
  getSnapshot: () => ipcRenderer.invoke('skillviewer:get-snapshot'),
  getMarketSnapshot: () => ipcRenderer.invoke('skillviewer:get-market-snapshot'),
  installMarketSkill: (payload) => ipcRenderer.invoke('skillviewer:install-market-skill', payload),
  openExternal: (url) => ipcRenderer.invoke('skillviewer:open-external', url),
  removeMarketRegistry: (registryId) => ipcRenderer.invoke('skillviewer:remove-market-registry', registryId),
  removeSource: (sourceId) => ipcRenderer.invoke('skillviewer:remove-source', sourceId),
  revealSkill: (filePath) => ipcRenderer.invoke('skillviewer:reveal-skill', filePath),
  saveSkill: (payload) => ipcRenderer.invoke('skillviewer:save-skill', payload),
  toggleMarketRegistry: (payload) => ipcRenderer.invoke('skillviewer:toggle-market-registry', payload),
  toggleSkill: (payload) => ipcRenderer.invoke('skillviewer:toggle-skill', payload),
  updateInstalledSkill: (payload) => ipcRenderer.invoke('skillviewer:update-installed-skill', payload),
}

contextBridge.exposeInMainWorld('skillviewer', api)

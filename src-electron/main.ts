import { app, BrowserWindow, ipcMain, shell, screen } from 'electron'
import path from 'node:path'

import { addSourceFromDialog, getSnapshot, removeSource, saveSkill, toggleSkill } from './skill-service'

let mainWindow: BrowserWindow | null = null

function getRendererEntry() {
  if (process.env.VITE_DEV_SERVER_URL) {
    return process.env.VITE_DEV_SERVER_URL
  }

  return path.join(__dirname, '../dist/index.html')
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.cjs')

  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

  // Set default dimensions dynamically: up to 1440x900, or 85% of smaller screens.
  const defaultWidth = Math.min(1440, Math.floor(screenWidth * 0.85))
  const defaultHeight = Math.min(900, Math.floor(screenHeight * 0.85))

  mainWindow = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    minHeight: 400,
    minWidth: 600,
    show: false,
    title: 'SkillViewer',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#eef2f4',
    trafficLightPosition: {
      x: 18,
      y: 18,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: false,
    },
  })

  const rendererEntry = getRendererEntry()

  if (rendererEntry.startsWith('http')) {
    void mainWindow.loadURL(rendererEntry)
  } else {
    void mainWindow.loadFile(rendererEntry)
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })
}

function registerIpc() {
  ipcMain.handle('skillviewer:add-source', async () => addSourceFromDialog(mainWindow))
  ipcMain.handle('skillviewer:get-snapshot', async () => getSnapshot())
  ipcMain.handle('skillviewer:remove-source', async (_event, sourceId: string) => removeSource(sourceId))
  ipcMain.handle('skillviewer:reveal-skill', async (_event, filePath: string) => {
    await shell.showItemInFolder(filePath)
  })
  ipcMain.handle('skillviewer:save-skill', async (_event, payload) => saveSkill(payload))
  ipcMain.handle('skillviewer:toggle-skill', async (_event, payload) => toggleSkill(payload))
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

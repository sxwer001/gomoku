/**
 * 五子棋 · 桌面端（Electron）主进程
 */
const { app, BrowserWindow, Menu, shell, dialog } = require('electron')
const path = require('node:path')

const APP_NAME = '五子棋'
let mainWindow = null

// 只允许运行一个实例
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 920,
    minWidth: 880,
    minHeight: 680,
    title: APP_NAME,
    backgroundColor: '#ffffff',
    autoHideMenuBar: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      // 单文件版把 AI 放进 Blob Worker；若被同源策略拦住，页面会自动降级到主线程
      webSecurity: true,
    },
  })

  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'))

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null })

  // 站内不跳外链；万一有，交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '游戏',
      submenu: [
        { label: '重新开始', accelerator: 'CmdOrCtrl+R', click: () => send('menu:restart') },
        { type: 'separator' },
        { label: '退出', role: isMac ? 'close' : 'quit' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '全屏', role: 'togglefullscreen' },
        { label: '重新加载', role: 'reload' },
        { type: 'separator' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { label: '重置缩放', role: 'resetZoom' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { label: '开发者工具', role: 'toggleDevTools' }]),
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于',
              message: APP_NAME,
              detail:
                `版本 ${app.getVersion()}\n\n` +
                '本地双人 / 人机对战\n' +
                'AI 引擎：@algorithm.ts/gomoku v4.0.5（MIT License）\n' +
                'https://github.com/guanghechen/algorithm.ts',
              buttons: ['好'],
            })
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function send(channel) {
  if (mainWindow) mainWindow.webContents.send(channel)
}

app.whenReady().then(() => {
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  desktopCapturer,
  screen,
  nativeImage,
  clipboard,
  dialog
} = require('electron');
const fs = require('fs');
const path = require('path');

let tray = null;
let captureWindow = null;
const pinWindows = new Set();

async function capturePrimaryScreenDataURL() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  });

  const source = sources.find((item) => item.display_id === String(primaryDisplay.id)) || sources[0];
  if (!source) {
    throw new Error('无法获取屏幕源');
  }

  return source.thumbnail.toDataURL();
}

function createCaptureWindow() {
  if (captureWindow && !captureWindow.isDestroyed()) {
    return captureWindow;
  }

  const display = screen.getPrimaryDisplay();
  captureWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    show: false,
    fullscreen: true,
    focusable: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  captureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  captureWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  captureWindow.on('closed', () => {
    captureWindow = null;
  });

  return captureWindow;
}

async function openCaptureOverlay() {
  const win = createCaptureWindow();
  const screenshot = await capturePrimaryScreenDataURL();

  const payload = { screenshot };
  if (win.webContents.isLoadingMainFrame()) {
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('capture:init', payload);
    });
  } else {
    win.webContents.send('capture:init', payload);
  }

  win.show();
  win.focus();
}

function createTray() {
  const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAQklEQVR42mNgoBvgP4M4w38GJgYGBjA4MDAw/2f4z8DAwMDA8J/BwMDAwMDw/4eBgYGB4f8MDAwMDAzAqQ0AADeuCZQdH6lJAAAAAElFTkSuQmCC');
  tray = new Tray(icon);
  tray.setToolTip('CutPro');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '唤醒截图 (Alt+A)', click: () => openCaptureOverlay() },
    { label: '退出', click: () => app.quit() }
  ]));
  tray.on('double-click', openCaptureOverlay);
}

function registerShortcuts() {
  const ok = globalShortcut.register('Alt+A', () => {
    void openCaptureOverlay();
  });

  if (!ok) {
    console.error('CutPro: Alt+A 快捷键注册失败');
  }
}

function createPinWindow(imageDataURL) {
  const pinWindow = new BrowserWindow({
    width: 360,
    height: 240,
    minWidth: 180,
    minHeight: 120,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true
    }
  });

  const html = `<!doctype html><html><body style="margin:0;background:#111;overflow:hidden;display:flex;align-items:center;justify-content:center;">
  <img src="${imageDataURL}" style="max-width:100%;max-height:100%;user-select:none;-webkit-user-drag:none;" />
</body></html>`;

  pinWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  pinWindow.on('closed', () => pinWindows.delete(pinWindow));
  pinWindows.add(pinWindow);
}

app.whenReady().then(() => {
  createTray();
  registerShortcuts();
  createCaptureWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createCaptureWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // 托盘常驻，不自动退出
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

ipcMain.handle('capture:close', () => {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.hide();
  }
});

ipcMain.handle('capture:copy-image', (_, dataURL) => {
  clipboard.writeImage(nativeImage.createFromDataURL(dataURL));
  return { copied: true };
});

ipcMain.handle('capture:save-image', async (_, dataURL) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '保存截图',
    defaultPath: `cutpro-${Date.now()}.png`,
    filters: [{ name: 'PNG 图片', extensions: ['png'] }]
  });

  if (canceled || !filePath) {
    return { saved: false };
  }

  const image = nativeImage.createFromDataURL(dataURL);
  fs.writeFileSync(filePath, image.toPNG());
  return { saved: true, filePath };
});

ipcMain.handle('capture:pin-image', (_, dataURL) => {
  createPinWindow(dataURL);
  return { pinned: true };
});

ipcMain.handle('capture:recapture', async () => {
  const screenshot = await capturePrimaryScreenDataURL();
  return { screenshot };
});

ipcMain.handle('capture:scroll-shot', async (_, options = {}) => {
  const count = Math.max(2, Math.min(10, Number(options.count) || 4));
  const interval = Math.max(50, Math.min(1000, Number(options.interval) || 180));

  const frames = [];
  for (let i = 0; i < count; i += 1) {
    const screenshot = await capturePrimaryScreenDataURL();
    frames.push(screenshot);
    if (i < count - 1) {
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  return { frames, count, interval };
});

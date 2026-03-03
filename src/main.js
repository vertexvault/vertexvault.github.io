const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, desktopCapturer, screen, nativeImage, clipboard, dialog } = require('electron');
const path = require('path');

let tray = null;
let captureWindow = null;
let pinWindows = new Set();

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
    movable: false,
    resizable: false,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  captureWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  captureWindow.on('closed', () => {
    captureWindow = null;
  });

  return captureWindow;
}

async function openCaptureOverlay() {
  const win = createCaptureWindow();
  const screenshot = await capturePrimaryScreenDataURL();

  if (!win.webContents.isLoadingMainFrame()) {
    win.webContents.send('capture:init', { screenshot });
  } else {
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('capture:init', { screenshot });
    });
  }

  win.show();
  win.focus();
}

function createTray() {
  const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAQklEQVR42mNgoBvgP4M4w38GJgYGBjA4MDAw/2f4z8DAwMDA8J/BwMDAwMDw/4eBgYGB4f8MDAwMDAzAqQ0AADeuCZQdH6lJAAAAAElFTkSuQmCC');
  tray = new Tray(icon);
  const contextMenu = Menu.buildFromTemplate([
    { label: '唤醒截图 (Alt+A)', click: () => openCaptureOverlay() },
    { label: '退出', click: () => app.quit() }
  ]);
  tray.setToolTip('CutPro');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', openCaptureOverlay);
}

function registerShortcuts() {
  globalShortcut.register('Alt+A', async () => {
    await openCaptureOverlay();
  });
}

function createPinWindow(imageDataURL) {
  const pinWin = new BrowserWindow({
    width: 360,
    height: 240,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true
    }
  });

  const html = `<!doctype html><html><body style="margin:0;background:#101010;display:flex;align-items:center;justify-content:center;overflow:hidden;">
    <img src="${imageDataURL}" style="max-width:100%;max-height:100%;user-select:none;-webkit-user-drag:none;" />
  </body></html>`;
  pinWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  pinWin.on('closed', () => pinWindows.delete(pinWin));
  pinWindows.add(pinWin);
}

app.whenReady().then(() => {
  createTray();
  registerShortcuts();
  createCaptureWindow();
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
});

ipcMain.handle('capture:save-image', async (_, dataURL) => {
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: '保存截图',
    defaultPath: `cutpro-${Date.now()}.png`,
    filters: [{ name: 'PNG 图片', extensions: ['png'] }]
  });

  if (canceled || !filePath) {
    return { saved: false };
  }

  const image = nativeImage.createFromDataURL(dataURL);
  require('fs').writeFileSync(filePath, image.toPNG());
  return { saved: true, filePath };
});

ipcMain.handle('capture:pin-image', (_, dataURL) => {
  createPinWindow(dataURL);
});

ipcMain.handle('capture:recapture', async () => {
  const screenshot = await capturePrimaryScreenDataURL();
  return { screenshot };
});

ipcMain.handle('capture:scroll-shot', async () => {
  // 以固定帧数量演示滚动截图拼接流程。
  const frames = [];
  for (let i = 0; i < 3; i += 1) {
    const screenshot = await capturePrimaryScreenDataURL();
    frames.push(screenshot);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return { frames };
});

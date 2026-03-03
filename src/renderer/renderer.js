const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const toolbar = document.getElementById('toolbar');
const magnifier = document.getElementById('magnifier');

const COLORS = ['#ffffff', '#000000', '#ff4d4f', '#fa8c16', '#fadb14', '#52c41a', '#1677ff', '#722ed1'];
const SIZES = [2, 4, 6];
const TOOLS = ['rect', 'ellipse', 'emoji', 'arrow', 'brush', 'mosaic', 'text'];

const state = {
  mode: 'idle',
  activeTool: 'rect',
  color: COLORS[0],
  size: SIZES[0],
  screenshotImage: null,
  selection: null,
  dragStart: null,
  resizeDir: null,
  hoverHandle: null,
  annotations: [],
  history: [],
  drawing: null,
  mouse: { x: 0, y: 0 }
};

const offscreen = document.createElement('canvas');
const offctx = offscreen.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;
  render();
}
window.addEventListener('resize', resizeCanvas);

function normalizeRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y)
  };
}

function pointInRect(pt, rect) {
  return rect && pt.x >= rect.x && pt.x <= rect.x + rect.w && pt.y >= rect.y && pt.y <= rect.y + rect.h;
}

function getHandles(rect) {
  if (!rect) return [];
  const { x, y, w, h } = rect;
  const mX = x + w / 2;
  const mY = y + h / 2;
  return [
    { dir: 'nw', x, y }, { dir: 'n', x: mX, y }, { dir: 'ne', x: x + w, y },
    { dir: 'e', x: x + w, y: mY }, { dir: 'se', x: x + w, y: y + h }, { dir: 's', x: mX, y: y + h },
    { dir: 'sw', x, y: y + h }, { dir: 'w', x, y: mY }
  ];
}

function detectHandle(pt) {
  const handles = getHandles(state.selection);
  return handles.find((h) => Math.abs(h.x - pt.x) <= 6 && Math.abs(h.y - pt.y) <= 6) || null;
}

function snapshot() {
  state.history.push(JSON.stringify(state.annotations));
  if (state.history.length > 50) state.history.shift();
}

function undo() {
  const last = state.history.pop();
  if (last) state.annotations = JSON.parse(last);
  render();
}

function drawBaseAndMask() {
  if (!state.screenshotImage) return;
  ctx.drawImage(state.screenshotImage, 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (state.selection) {
    const { x, y, w, h } = state.selection;
    ctx.drawImage(state.screenshotImage, x, y, w, h, x, y, w, h);
    ctx.strokeStyle = '#00c853';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);

    getHandles(state.selection).forEach((h) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(h.x - 4, h.y - 4, 8, 8);
      ctx.strokeStyle = '#00c853';
      ctx.strokeRect(h.x - 4, h.y - 4, 8, 8);
    });
  }
}

function renderAnnotation(a) {
  offctx.save();
  offctx.strokeStyle = a.color;
  offctx.fillStyle = a.color;
  offctx.lineWidth = a.size;
  offctx.lineCap = 'round';
  offctx.lineJoin = 'round';

  if (a.type === 'rect') offctx.strokeRect(a.x, a.y, a.w, a.h);
  if (a.type === 'ellipse') {
    offctx.beginPath();
    offctx.ellipse(a.x + a.w / 2, a.y + a.h / 2, Math.abs(a.w / 2), Math.abs(a.h / 2), 0, 0, Math.PI * 2);
    offctx.stroke();
  }
  if (a.type === 'arrow') {
    const dx = a.x2 - a.x1;
    const dy = a.y2 - a.y1;
    const ang = Math.atan2(dy, dx);
    offctx.beginPath();
    offctx.moveTo(a.x1, a.y1);
    offctx.lineTo(a.x2, a.y2);
    offctx.stroke();
    offctx.beginPath();
    offctx.moveTo(a.x2, a.y2);
    offctx.lineTo(a.x2 - 12 * Math.cos(ang - Math.PI / 6), a.y2 - 12 * Math.sin(ang - Math.PI / 6));
    offctx.lineTo(a.x2 - 12 * Math.cos(ang + Math.PI / 6), a.y2 - 12 * Math.sin(ang + Math.PI / 6));
    offctx.closePath();
    offctx.fill();
  }
  if (a.type === 'brush') {
    offctx.beginPath();
    a.points.forEach((p, idx) => (idx === 0 ? offctx.moveTo(p.x, p.y) : offctx.lineTo(p.x, p.y)));
    offctx.stroke();
  }
  if (a.type === 'mosaic') {
    offctx.save();
    offctx.globalAlpha = 0.75;
    a.points.forEach((p) => offctx.fillRect(p.x - 6, p.y - 6, 12, 12));
    offctx.restore();
  }
  if (a.type === 'text') {
    offctx.font = `${12 + a.size * 2}px sans-serif`;
    offctx.fillText(a.text || '文字', a.x, a.y);
  }
  if (a.type === 'emoji') {
    offctx.font = `${16 + a.size * 2}px sans-serif`;
    offctx.fillText('😀', a.x, a.y);
  }

  offctx.restore();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  offctx.clearRect(0, 0, offscreen.width, offscreen.height);

  drawBaseAndMask();

  state.annotations.forEach(renderAnnotation);
  if (state.drawing) renderAnnotation(state.drawing);

  if (state.selection) {
    const { x, y, w, h } = state.selection;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.drawImage(offscreen, 0, 0);
    ctx.restore();
  }
}

function setToolbarPosition() {
  if (!state.selection) return;
  const top = Math.min(canvas.height - 56, state.selection.y + state.selection.h + 10);
  const left = Math.max(6, Math.min(canvas.width - toolbar.offsetWidth - 6, state.selection.x));
  toolbar.style.top = `${top}px`;
  toolbar.style.left = `${left}px`;
}

function makeToolbar() {
  const addBtn = (id, label, group = false) => {
    if (group) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      toolbar.appendChild(sep);
    }
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.dataset.id = id;
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onToolbarAction(id);
    });
    toolbar.appendChild(btn);
    return btn;
  };

  [...TOOLS, 'scroll', 'pin', 'undo', 'save', 'copy', 'cancel', 'ok'].forEach((id) => {
    const labels = {
      rect: '矩形', ellipse: '椭圆', emoji: '表情', arrow: '箭头', brush: '画笔', mosaic: '马赛克', text: '文字',
      scroll: '滚动截图', pin: '钉图', undo: '撤销', save: '保存', copy: '复制', cancel: '取消', ok: '确认'
    };
    const beforeSep = ['scroll', 'undo', 'cancel'].includes(id);
    addBtn(id, labels[id], beforeSep);
  });

  COLORS.forEach((color) => {
    const btn = document.createElement('button');
    btn.className = 'color';
    btn.style.background = color;
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.color = color;
    });
    toolbar.appendChild(btn);
  });

  const sizeSel = document.createElement('select');
  SIZES.forEach((size) => {
    const opt = document.createElement('option');
    opt.value = size;
    opt.textContent = `${size}px`;
    sizeSel.appendChild(opt);
  });
  sizeSel.addEventListener('mousedown', (e) => e.stopPropagation());
  sizeSel.addEventListener('change', () => { state.size = Number(sizeSel.value); });
  toolbar.appendChild(sizeSel);
}

async function onToolbarAction(id) {
  if (TOOLS.includes(id)) {
    state.activeTool = id;
    [...toolbar.querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b.dataset.id === id));
    return;
  }
  if (id === 'cancel') return window.cutpro.close();
  if (id === 'undo') return undo();
  if (id === 'save') return saveSelection();
  if (id === 'copy' || id === 'ok') return copyAndClose();
  if (id === 'pin') return pinSelection();
  if (id === 'scroll') return doScrollShot();
}

async function doScrollShot() {
  const { frames } = await window.cutpro.scrollShot();
  if (!frames?.length || !state.selection) return;
  const imgList = await Promise.all(frames.map(loadImage));
  const stitched = document.createElement('canvas');
  stitched.width = state.selection.w;
  stitched.height = state.selection.h * imgList.length;
  const sctx = stitched.getContext('2d');
  imgList.forEach((img, idx) => {
    sctx.drawImage(img, state.selection.x, state.selection.y, state.selection.w, state.selection.h, 0, idx * state.selection.h, state.selection.w, state.selection.h);
  });
  const dataURL = stitched.toDataURL('image/png');
  await window.cutpro.copyImage(dataURL);
}

async function saveSelection() {
  const dataURL = exportSelection();
  await window.cutpro.saveImage(dataURL);
}

async function copyAndClose() {
  const dataURL = exportSelection();
  await window.cutpro.copyImage(dataURL);
  await window.cutpro.close();
}

async function pinSelection() {
  const dataURL = exportSelection();
  await window.cutpro.pinImage(dataURL);
}

function exportSelection() {
  const { x, y, w, h } = state.selection;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  octx.drawImage(state.screenshotImage, x, y, w, h, 0, 0, w, h);
  octx.drawImage(offscreen, x, y, w, h, 0, 0, w, h);
  return out.toDataURL('image/png');
}

function loadImage(dataURL) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = dataURL;
  });
}

canvas.addEventListener('mousedown', (e) => {
  const pt = { x: e.offsetX, y: e.offsetY };
  state.mouse = pt;

  if (state.mode === 'idle') {
    state.mode = 'selecting';
    state.dragStart = pt;
    state.selection = { x: pt.x, y: pt.y, w: 0, h: 0 };
    return;
  }

  if (state.mode === 'selected') {
    const handle = detectHandle(pt);
    if (handle) {
      state.mode = 'resizing';
      state.resizeDir = handle.dir;
      state.dragStart = pt;
      return;
    }

    if (pointInRect(pt, state.selection) && e.altKey) {
      state.mode = 'moving';
      state.dragStart = pt;
      return;
    }

    if (pointInRect(pt, state.selection)) {
      snapshot();
      if (state.activeTool === 'text') {
        const text = prompt('输入文字：', 'CutPro') || 'CutPro';
        state.annotations.push({ type: 'text', x: pt.x, y: pt.y, text, color: state.color, size: state.size });
        render();
        return;
      }
      if (state.activeTool === 'emoji') {
        state.annotations.push({ type: 'emoji', x: pt.x, y: pt.y, color: state.color, size: state.size });
        render();
        return;
      }
      state.mode = 'drawing';
      state.dragStart = pt;
      state.drawing = createDraft(pt);
    }
  }
});

canvas.addEventListener('mousemove', (e) => {
  const pt = { x: e.offsetX, y: e.offsetY };
  state.mouse = pt;

  if (state.mode === 'selecting') {
    state.selection = normalizeRect(state.dragStart, pt);
  } else if (state.mode === 'drawing' && state.drawing) {
    updateDraft(state.drawing, pt);
  } else if (state.mode === 'moving') {
    const dx = pt.x - state.dragStart.x;
    const dy = pt.y - state.dragStart.y;
    state.selection.x += dx;
    state.selection.y += dy;
    state.dragStart = pt;
    setToolbarPosition();
  } else if (state.mode === 'resizing') {
    resizeSelection(pt);
    setToolbarPosition();
  }

  updateMagnifier(pt);
  render();
});

canvas.addEventListener('mouseup', () => {
  if (state.mode === 'selecting') {
    if (state.selection.w > 5 && state.selection.h > 5) {
      state.mode = 'selected';
      toolbar.classList.remove('hidden');
      setToolbarPosition();
    } else {
      state.mode = 'idle';
      state.selection = null;
    }
  } else if (state.mode === 'drawing') {
    if (state.drawing) state.annotations.push(state.drawing);
    state.drawing = null;
    state.mode = 'selected';
  } else if (state.mode === 'moving' || state.mode === 'resizing') {
    state.mode = 'selected';
  }
  render();
});

function createDraft(pt) {
  if (state.activeTool === 'brush' || state.activeTool === 'mosaic') {
    return { type: state.activeTool, points: [pt], color: state.color, size: state.size };
  }
  if (state.activeTool === 'arrow') {
    return { type: 'arrow', x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y, color: state.color, size: state.size };
  }
  return { type: state.activeTool, x: pt.x, y: pt.y, w: 0, h: 0, color: state.color, size: state.size };
}

function updateDraft(draft, pt) {
  if (draft.type === 'brush' || draft.type === 'mosaic') {
    draft.points.push(pt);
  } else if (draft.type === 'arrow') {
    draft.x2 = pt.x;
    draft.y2 = pt.y;
  } else {
    const rect = normalizeRect({ x: draft.x, y: draft.y }, pt);
    draft.x = rect.x; draft.y = rect.y; draft.w = rect.w; draft.h = rect.h;
  }
}

function resizeSelection(pt) {
  const sel = state.selection;
  const dx = pt.x - state.dragStart.x;
  const dy = pt.y - state.dragStart.y;
  const dir = state.resizeDir;

  if (dir.includes('e')) sel.w += dx;
  if (dir.includes('s')) sel.h += dy;
  if (dir.includes('w')) { sel.x += dx; sel.w -= dx; }
  if (dir.includes('n')) { sel.y += dy; sel.h -= dy; }

  sel.w = Math.max(10, sel.w);
  sel.h = Math.max(10, sel.h);
  state.dragStart = pt;
}

function updateMagnifier(pt) {
  if (state.mode !== 'selecting') {
    magnifier.classList.add('hidden');
    return;
  }
  const px = ctx.getImageData(Math.max(0, pt.x - 1), Math.max(0, pt.y - 1), 1, 1).data;
  magnifier.innerHTML = `坐标: ${pt.x}, ${pt.y}<br/>颜色: rgb(${px[0]},${px[1]},${px[2]})`;
  magnifier.style.left = `${Math.min(canvas.width - 130, pt.x + 20)}px`;
  magnifier.style.top = `${Math.min(canvas.height - 80, pt.y + 20)}px`;
  magnifier.classList.remove('hidden');
}

document.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    await window.cutpro.close();
  } else if (e.key === 'Enter' && state.selection) {
    await copyAndClose();
  } else if (e.ctrlKey && e.key.toLowerCase() === 's' && state.selection) {
    e.preventDefault();
    await saveSelection();
  }
});

window.cutpro.onInit(async ({ screenshot }) => {
  state.screenshotImage = await loadImage(screenshot);
  resizeCanvas();
});

makeToolbar();
render();

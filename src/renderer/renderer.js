const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const toolbar = document.getElementById('toolbar');
const magnifier = document.getElementById('magnifier');

const COLORS = ['#ffffff', '#000000', '#ff4d4f', '#fa8c16', '#fadb14', '#52c41a', '#1677ff', '#722ed1'];
const SIZES = [2, 4, 6];
const TOOL_ORDER = ['rect', 'ellipse', 'emoji', 'arrow', 'brush', 'mosaic', 'text'];

const TOOL_LABELS = {
  rect: '矩形',
  ellipse: '椭圆',
  emoji: '表情',
  arrow: '箭头',
  brush: '画笔',
  mosaic: '马赛克',
  text: '文字',
  scroll: '滚动截图',
  pin: '钉图',
  undo: '撤销',
  save: '保存',
  copy: '复制',
  cancel: '取消',
  ok: '确认'
};

const state = {
  mode: 'idle', // idle -> selecting -> selected
  activeTool: 'rect',
  color: COLORS[2],
  size: SIZES[1],
  screenshotImage: null,
  selection: null,
  dragStart: null,
  moveOffset: null,
  resizeDir: null,
  annotations: [],
  history: [],
  drawing: null,
  hintText: '拖拽鼠标框选截图区域'
};

const offscreen = document.createElement('canvas');
const offctx = offscreen.getContext('2d');

const HANDLE_SIZE = 8;
const MIN_SELECT_SIZE = 10;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  offscreen.width = canvas.width;
  offscreen.height = canvas.height;
  render();
}
window.addEventListener('resize', resizeCanvas);

function setHint(text) {
  state.hintText = text;
  render();
}

function normalizeRect(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(start.x - end.x),
    h: Math.abs(start.y - end.y)
  };
}

function clampSelection() {
  if (!state.selection) return;
  state.selection.x = Math.max(0, Math.min(canvas.width - state.selection.w, state.selection.x));
  state.selection.y = Math.max(0, Math.min(canvas.height - state.selection.h, state.selection.y));
  state.selection.w = Math.max(MIN_SELECT_SIZE, Math.min(canvas.width - state.selection.x, state.selection.w));
  state.selection.h = Math.max(MIN_SELECT_SIZE, Math.min(canvas.height - state.selection.y, state.selection.h));
}

function pointInRect(pt, rect) {
  return !!rect && pt.x >= rect.x && pt.x <= rect.x + rect.w && pt.y >= rect.y && pt.y <= rect.y + rect.h;
}

function getHandles(rect) {
  if (!rect) return [];
  const { x, y, w, h } = rect;
  const midX = x + w / 2;
  const midY = y + h / 2;
  return [
    { dir: 'nw', x, y }, { dir: 'n', x: midX, y }, { dir: 'ne', x: x + w, y },
    { dir: 'e', x: x + w, y: midY }, { dir: 'se', x: x + w, y: y + h }, { dir: 's', x: midX, y: y + h },
    { dir: 'sw', x, y: y + h }, { dir: 'w', x, y: midY }
  ];
}

function detectHandle(point) {
  return getHandles(state.selection).find((h) => (
    Math.abs(h.x - point.x) <= HANDLE_SIZE && Math.abs(h.y - point.y) <= HANDLE_SIZE
  )) || null;
}

function loadImage(dataURL) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.src = dataURL;
  });
}

function snapshot() {
  state.history.push(JSON.stringify(state.annotations));
  if (state.history.length > 100) {
    state.history.shift();
  }
}

function undo() {
  if (!state.history.length) {
    setHint('没有可撤销的步骤');
    return;
  }
  state.annotations = JSON.parse(state.history.pop());
  setHint('已撤销一步');
}

function drawHint() {
  if (state.mode !== 'idle' && state.mode !== 'selecting') return;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.65)';
  ctx.fillRect(16, 16, 260, 28);
  ctx.fillStyle = '#fff';
  ctx.font = '14px "Microsoft YaHei"';
  ctx.fillText(state.hintText, 26, 35);
  ctx.restore();
}

function drawBaseMaskAndSelection() {
  if (!state.screenshotImage) return;

  ctx.drawImage(state.screenshotImage, 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (state.selection) {
    const { x, y, w, h } = state.selection;
    ctx.drawImage(state.screenshotImage, x, y, w, h, x, y, w, h);

    ctx.strokeStyle = '#00C853';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);

    getHandles(state.selection).forEach((h) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      ctx.strokeStyle = '#00C853';
      ctx.strokeRect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    });
  }

  drawHint();
}

function renderAnnotation(annotation) {
  offctx.save();
  offctx.strokeStyle = annotation.color;
  offctx.fillStyle = annotation.color;
  offctx.lineWidth = annotation.size;
  offctx.lineCap = 'round';
  offctx.lineJoin = 'round';

  switch (annotation.type) {
    case 'rect':
      offctx.strokeRect(annotation.x, annotation.y, annotation.w, annotation.h);
      break;
    case 'ellipse':
      offctx.beginPath();
      offctx.ellipse(
        annotation.x + annotation.w / 2,
        annotation.y + annotation.h / 2,
        Math.abs(annotation.w / 2),
        Math.abs(annotation.h / 2),
        0,
        0,
        Math.PI * 2
      );
      offctx.stroke();
      break;
    case 'arrow': {
      const angle = Math.atan2(annotation.y2 - annotation.y1, annotation.x2 - annotation.x1);
      offctx.beginPath();
      offctx.moveTo(annotation.x1, annotation.y1);
      offctx.lineTo(annotation.x2, annotation.y2);
      offctx.stroke();

      offctx.beginPath();
      offctx.moveTo(annotation.x2, annotation.y2);
      offctx.lineTo(annotation.x2 - 14 * Math.cos(angle - Math.PI / 7), annotation.y2 - 14 * Math.sin(angle - Math.PI / 7));
      offctx.lineTo(annotation.x2 - 14 * Math.cos(angle + Math.PI / 7), annotation.y2 - 14 * Math.sin(angle + Math.PI / 7));
      offctx.closePath();
      offctx.fill();
      break;
    }
    case 'brush':
      offctx.beginPath();
      annotation.points.forEach((p, idx) => {
        if (idx === 0) offctx.moveTo(p.x, p.y);
        else offctx.lineTo(p.x, p.y);
      });
      offctx.stroke();
      break;
    case 'mosaic':
      offctx.save();
      offctx.globalAlpha = 0.7;
      annotation.points.forEach((p) => offctx.fillRect(p.x - 6, p.y - 6, 12, 12));
      offctx.restore();
      break;
    case 'text':
      offctx.font = `${14 + annotation.size * 2}px "Microsoft YaHei"`;
      offctx.fillText(annotation.text, annotation.x, annotation.y);
      break;
    case 'emoji':
      offctx.font = `${18 + annotation.size * 2}px sans-serif`;
      offctx.fillText(annotation.emoji || '😀', annotation.x, annotation.y);
      break;
    default:
      break;
  }

  offctx.restore();
}

function drawMergedAnnotations() {
  offctx.clearRect(0, 0, offscreen.width, offscreen.height);
  state.annotations.forEach(renderAnnotation);
  if (state.drawing) renderAnnotation(state.drawing);

  if (!state.selection) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(state.selection.x, state.selection.y, state.selection.w, state.selection.h);
  ctx.clip();
  ctx.drawImage(offscreen, 0, 0);
  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBaseMaskAndSelection();
  drawMergedAnnotations();
  positionToolbar();
}

function positionToolbar() {
  if (!state.selection || toolbar.classList.contains('hidden')) return;
  const top = Math.min(canvas.height - 56, state.selection.y + state.selection.h + 10);
  const left = Math.max(8, Math.min(canvas.width - toolbar.offsetWidth - 8, state.selection.x));
  toolbar.style.top = `${top}px`;
  toolbar.style.left = `${left}px`;
}

function setSelectedTool(tool) {
  state.activeTool = tool;
  toolbar.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.id === tool);
  });
}

function makeToolbar() {
  const groups = [
    ['rect', 'ellipse', 'emoji', 'arrow', 'brush', 'mosaic', 'text'],
    ['scroll', 'pin'],
    ['undo', 'save', 'copy'],
    ['cancel', 'ok']
  ];

  groups.forEach((group, groupIdx) => {
    if (groupIdx > 0) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      toolbar.appendChild(sep);
    }

    group.forEach((id) => {
      const button = document.createElement('button');
      button.dataset.id = id;
      button.textContent = TOOL_LABELS[id];
      button.addEventListener('mousedown', (event) => event.stopPropagation());
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        void handleToolbarAction(id);
      });
      toolbar.appendChild(button);
    });
  });

  const paletteWrap = document.createElement('div');
  paletteWrap.className = 'palette';

  COLORS.forEach((color) => {
    const button = document.createElement('button');
    button.className = 'color';
    button.style.backgroundColor = color;
    button.title = color;
    button.addEventListener('mousedown', (event) => event.stopPropagation());
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      state.color = color;
    });
    paletteWrap.appendChild(button);
  });
  toolbar.appendChild(paletteWrap);

  const sizeSelect = document.createElement('select');
  sizeSelect.className = 'size';
  SIZES.forEach((size) => {
    const opt = document.createElement('option');
    opt.value = String(size);
    opt.textContent = `${size}px`;
    sizeSelect.appendChild(opt);
  });
  sizeSelect.value = String(state.size);
  sizeSelect.addEventListener('mousedown', (event) => event.stopPropagation());
  sizeSelect.addEventListener('change', () => {
    state.size = Number(sizeSelect.value);
  });

  toolbar.appendChild(sizeSelect);
  setSelectedTool(state.activeTool);
}

function createDraft(point) {
  switch (state.activeTool) {
    case 'brush':
    case 'mosaic':
      return { type: state.activeTool, points: [point], color: state.color, size: state.size };
    case 'arrow':
      return { type: 'arrow', x1: point.x, y1: point.y, x2: point.x, y2: point.y, color: state.color, size: state.size };
    default:
      return { type: state.activeTool, x: point.x, y: point.y, w: 0, h: 0, color: state.color, size: state.size };
  }
}

function updateDraft(draft, point) {
  if (draft.type === 'brush' || draft.type === 'mosaic') {
    draft.points.push(point);
    return;
  }
  if (draft.type === 'arrow') {
    draft.x2 = point.x;
    draft.y2 = point.y;
    return;
  }
  const rect = normalizeRect({ x: draft.x, y: draft.y }, point);
  draft.x = rect.x;
  draft.y = rect.y;
  draft.w = rect.w;
  draft.h = rect.h;
}

function startSelecting(point) {
  state.mode = 'selecting';
  state.dragStart = point;
  state.selection = { x: point.x, y: point.y, w: 0, h: 0 };
  toolbar.classList.add('hidden');
}

function startInteractionInSelected(point) {
  const handle = detectHandle(point);
  if (handle) {
    state.mode = 'resizing';
    state.dragStart = point;
    state.resizeDir = handle.dir;
    return;
  }

  if (!pointInRect(point, state.selection)) {
    startSelecting(point);
    return;
  }

  // 按住空格可直接拖拽选区，否则进入标注绘制
  if (state.activeTool === 'text') {
    const text = window.prompt('输入文字：', 'CutPro') || 'CutPro';
    snapshot();
    state.annotations.push({ type: 'text', x: point.x, y: point.y, text, color: state.color, size: state.size });
    render();
    return;
  }

  if (state.activeTool === 'emoji') {
    snapshot();
    state.annotations.push({ type: 'emoji', x: point.x, y: point.y, emoji: '😀', color: state.color, size: state.size });
    render();
    return;
  }

  if (window.__spaceMoving) {
    state.mode = 'moving';
    state.moveOffset = { x: point.x - state.selection.x, y: point.y - state.selection.y };
    return;
  }

  snapshot();
  state.mode = 'drawing';
  state.dragStart = point;
  state.drawing = createDraft(point);
}

function resizeSelection(point) {
  if (!state.selection || !state.dragStart) return;

  const dx = point.x - state.dragStart.x;
  const dy = point.y - state.dragStart.y;
  const rect = { ...state.selection };

  if (state.resizeDir.includes('e')) rect.w += dx;
  if (state.resizeDir.includes('s')) rect.h += dy;
  if (state.resizeDir.includes('w')) {
    rect.x += dx;
    rect.w -= dx;
  }
  if (state.resizeDir.includes('n')) {
    rect.y += dy;
    rect.h -= dy;
  }

  if (rect.w < MIN_SELECT_SIZE) rect.w = MIN_SELECT_SIZE;
  if (rect.h < MIN_SELECT_SIZE) rect.h = MIN_SELECT_SIZE;

  state.selection = rect;
  clampSelection();
  state.dragStart = point;
}

function updateMagnifier(point) {
  if (state.mode !== 'selecting') {
    magnifier.classList.add('hidden');
    return;
  }

  const px = ctx.getImageData(Math.max(0, point.x), Math.max(0, point.y), 1, 1).data;
  magnifier.innerHTML = `坐标: ${point.x}, ${point.y}<br />颜色: rgb(${px[0]}, ${px[1]}, ${px[2]})`;
  magnifier.style.left = `${Math.min(canvas.width - 132, point.x + 18)}px`;
  magnifier.style.top = `${Math.min(canvas.height - 84, point.y + 18)}px`;
  magnifier.classList.remove('hidden');
}

canvas.addEventListener('mousedown', (event) => {
  const point = { x: event.offsetX, y: event.offsetY };

  if (!state.screenshotImage) return;

  if (state.mode === 'idle') {
    startSelecting(point);
    render();
    return;
  }

  if (state.mode === 'selected') {
    startInteractionInSelected(point);
    render();
  }
});

canvas.addEventListener('mousemove', (event) => {
  const point = { x: event.offsetX, y: event.offsetY };

  if (state.mode === 'selecting' && state.dragStart) {
    state.selection = normalizeRect(state.dragStart, point);
  } else if (state.mode === 'resizing') {
    resizeSelection(point);
  } else if (state.mode === 'moving' && state.moveOffset) {
    state.selection.x = point.x - state.moveOffset.x;
    state.selection.y = point.y - state.moveOffset.y;
    clampSelection();
  } else if (state.mode === 'drawing' && state.drawing) {
    updateDraft(state.drawing, point);
  }

  updateMagnifier(point);
  render();
});

canvas.addEventListener('mouseup', () => {
  if (state.mode === 'selecting') {
    if (state.selection && state.selection.w >= MIN_SELECT_SIZE && state.selection.h >= MIN_SELECT_SIZE) {
      state.mode = 'selected';
      toolbar.classList.remove('hidden');
      setHint('已选中区域，可进行标注');
    } else {
      state.mode = 'idle';
      state.selection = null;
      setHint('拖拽鼠标框选截图区域');
    }
  } else if (state.mode === 'drawing') {
    if (state.drawing) state.annotations.push(state.drawing);
    state.drawing = null;
    state.mode = 'selected';
  } else if (state.mode === 'resizing' || state.mode === 'moving') {
    state.mode = 'selected';
  }

  render();
});

async function exportSelection() {
  if (!state.selection || !state.screenshotImage) {
    throw new Error('未选择截图区域');
  }

  const { x, y, w, h } = state.selection;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;

  const outCtx = out.getContext('2d');
  outCtx.drawImage(state.screenshotImage, x, y, w, h, 0, 0, w, h);
  outCtx.drawImage(offscreen, x, y, w, h, 0, 0, w, h);

  return out.toDataURL('image/png');
}

async function copyAndClose() {
  const dataUrl = await exportSelection();
  await window.cutpro.copyImage(dataUrl);
  await window.cutpro.close();
}

async function saveSelection() {
  const dataUrl = await exportSelection();
  const result = await window.cutpro.saveImage(dataUrl);
  if (result?.saved) {
    setHint(`已保存: ${result.filePath}`);
  }
}

async function pinSelection() {
  const dataUrl = await exportSelection();
  await window.cutpro.pinImage(dataUrl);
  setHint('已创建钉图窗口');
}

async function doScrollShot() {
  if (!state.selection) return;
  setHint('滚动截图采集中...');

  const { frames } = await window.cutpro.scrollShot({ count: 5, interval: 180 });
  if (!frames || frames.length < 1) {
    setHint('滚动截图失败');
    return;
  }

  const images = await Promise.all(frames.map(loadImage));
  const stitched = document.createElement('canvas');
  stitched.width = state.selection.w;
  stitched.height = state.selection.h * images.length;
  const stitchedCtx = stitched.getContext('2d');

  images.forEach((img, idx) => {
    stitchedCtx.drawImage(
      img,
      state.selection.x,
      state.selection.y,
      state.selection.w,
      state.selection.h,
      0,
      idx * state.selection.h,
      state.selection.w,
      state.selection.h
    );
  });

  await window.cutpro.copyImage(stitched.toDataURL('image/png'));
  setHint(`滚动截图完成，共 ${images.length} 帧，已复制`);
}

async function handleToolbarAction(id) {
  if (TOOL_ORDER.includes(id)) {
    setSelectedTool(id);
    return;
  }

  if (id === 'scroll') {
    await doScrollShot();
  } else if (id === 'pin') {
    await pinSelection();
  } else if (id === 'undo') {
    undo();
  } else if (id === 'save') {
    await saveSelection();
  } else if (id === 'copy' || id === 'ok') {
    await copyAndClose();
  } else if (id === 'cancel') {
    await window.cutpro.close();
  }

  render();
}

document.addEventListener('keydown', async (event) => {
  if (event.key === ' ') {
    window.__spaceMoving = true;
  }

  if (event.key === 'Escape') {
    await window.cutpro.close();
  } else if (event.key === 'Enter' && state.selection) {
    await copyAndClose();
  } else if (event.ctrlKey && event.key.toLowerCase() === 's' && state.selection) {
    event.preventDefault();
    await saveSelection();
  }
});

document.addEventListener('keyup', (event) => {
  if (event.key === ' ') {
    window.__spaceMoving = false;
  }
});

window.cutpro.onInit(async ({ screenshot }) => {
  state.screenshotImage = await loadImage(screenshot);
  state.mode = 'idle';
  state.selection = null;
  state.annotations = [];
  state.history = [];
  toolbar.classList.add('hidden');
  setHint('拖拽鼠标框选截图区域');
  resizeCanvas();
});

makeToolbar();
render();

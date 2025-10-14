import type { ListResponse, R2ObjectSummary, UploadProgress } from './types';

const app = document.getElementById('app');
if (!app) {
  throw new Error('No se encontró el contenedor #app');
}

type ItemType = 'image' | 'video' | 'other' | 'prefix';

interface State {
  bucket: string;
  prefix: string;
  rootPrefix: string;
  search: string;
  currentToken?: string;
  nextContinuationToken?: string;
  history: (string | undefined)[];
  objects: R2ObjectSummary[];
  commonPrefixes: string[];
  loading: boolean;
}

interface UploadTracker {
  id: string;
  key: string;
  loaded: number;
  total?: number;
}

const state: State = {
  bucket: '',
  prefix: '',
  rootPrefix: '',
  search: '',
  currentToken: undefined,
  nextContinuationToken: undefined,
  history: [],
  objects: [],
  commonPrefixes: [],
  loading: false
};

const knownPrefixes = new Set<string>();
const uploadMap = new Map<string, UploadTracker>();

app.innerHTML = `
  <aside class="sidebar">
    <h1>Personal View</h1>
    <button id="refresh">Actualizar</button>
    <button id="new-folder">Nueva carpeta</button>
    <button id="diagnostics">Diagnóstico</button>
    <div class="tree" id="tree"></div>
  </aside>
  <section class="main" id="main">
    <div class="toolbar">
      <div class="breadcrumbs" id="breadcrumbs"></div>
      <input type="search" id="search" placeholder="Buscar por prefijo" />
      <button id="prev-page">Anterior</button>
      <button id="next-page">Siguiente</button>
    </div>
    <div class="grid" id="grid"></div>
  </section>
  <div class="toast-container" id="toasts"></div>
`;

const grid = document.getElementById('grid')!;
const breadcrumbs = document.getElementById('breadcrumbs')!;
const treeContainer = document.getElementById('tree')!;
const toasts = document.getElementById('toasts')!;
const searchInput = document.getElementById('search') as HTMLInputElement;
const prevBtn = document.getElementById('prev-page') as HTMLButtonElement;
const nextBtn = document.getElementById('next-page') as HTMLButtonElement;

let searchDebounce: number | undefined;
let overlay: HTMLElement | null = null;

function showToast(message: string, type: 'success' | 'error' | 'info' = 'info', timeout = 3200) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  toasts.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    el.remove();
  }, timeout);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  return date.toLocaleString();
}

function detectType(item: R2ObjectSummary): ItemType {
  if (!item.contentType) {
    if (/\.(jpe?g|png|gif|webp)$/i.test(item.key)) return 'image';
    if (/\.(mp4|mov|m4v|webm)$/i.test(item.key)) return 'video';
    return 'other';
  }
  if (item.contentType.startsWith('image/')) return 'image';
  if (item.contentType.startsWith('video/')) return 'video';
  return 'other';
}

function relativePrefix(prefix: string): string {
  if (!state.rootPrefix) return prefix;
  if (!prefix.startsWith(state.rootPrefix)) return prefix;
  return prefix.slice(state.rootPrefix.length);
}

function buildBreadcrumbs() {
  breadcrumbs.innerHTML = '';
  const current = state.prefix || state.rootPrefix;
  const relative = relativePrefix(current);
  const segments = relative.split('/').filter(Boolean);
  const parts: { label: string; value: string }[] = [];
  parts.push({ label: '/', value: state.rootPrefix });
  let acc = state.rootPrefix;
  segments.forEach((segment) => {
    acc = `${acc}${acc.endsWith('/') || !acc ? '' : '/'}${segment}/`;
    parts.push({ label: segment, value: acc });
  });
  parts.forEach((part, idx) => {
    const span = document.createElement('span');
    span.textContent = part.label;
    if (idx === parts.length - 1) {
      span.classList.add('active');
    }
    span.addEventListener('click', () => {
      goToPrefix(part.value);
    });
    breadcrumbs.appendChild(span);
    if (idx < parts.length - 1) {
      const sep = document.createElement('span');
      sep.textContent = '/';
      sep.style.pointerEvents = 'none';
      breadcrumbs.appendChild(sep);
    }
  });
}

function updatePaginationControls() {
  prevBtn.disabled = state.history.length === 0;
  nextBtn.disabled = !state.nextContinuationToken;
}

function buildTree() {
  const prefixes = Array.from(knownPrefixes).sort((a, b) => a.localeCompare(b));
  const root = state.rootPrefix;
  const tree: Record<string, Set<string>> = {};
  prefixes.forEach((prefix) => {
    if (!prefix.startsWith(root)) return;
    const relative = prefix.slice(root.length);
    const segments = relative.split('/').filter(Boolean);
    let current = root;
    segments.forEach((segment) => {
      const next = `${current}${current.endsWith('/') || !current ? '' : '/'}${segment}/`;
      if (!tree[current]) tree[current] = new Set();
      tree[current].add(next);
      current = next;
    });
  });

  function renderNode(prefix: string): HTMLUListElement {
    const children = Array.from(tree[prefix] ?? []).sort();
    const ul = document.createElement('ul');
    children.forEach((child) => {
      const li = document.createElement('li');
      li.textContent = relativePrefix(child).split('/').filter(Boolean).slice(-1)[0] || '/';
      if (state.prefix === child) {
        li.classList.add('active');
      }
      li.addEventListener('click', () => goToPrefix(child));
      li.appendChild(renderNode(child));
      ul.appendChild(li);
    });
    return ul;
  }

  treeContainer.innerHTML = '';
  const rootNode = document.createElement('div');
  rootNode.textContent = 'Bucket';
  rootNode.classList.add('root');
  rootNode.addEventListener('click', () => goToPrefix(root));
  treeContainer.appendChild(rootNode);
  treeContainer.appendChild(renderNode(root));
}

function clearGrid() {
  grid.innerHTML = '';
}

function renderEmptyState(message: string) {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent = message;
  grid.appendChild(empty);
}

function createCard(item: R2ObjectSummary) {
  const type = detectType(item);
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.key = item.key;
  const preview = document.createElement('div');
  preview.className = 'preview';
  preview.textContent = '…';
  card.appendChild(preview);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = item.key.split('/').filter(Boolean).slice(-1)[0] || item.key;
  const info = document.createElement('div');
  info.className = 'info';
  info.textContent = `${formatBytes(item.size)} · ${formatDate(item.lastModified)}${
    item.contentType ? ` · ${item.contentType}` : ''
  }`;
  meta.appendChild(name);
  meta.appendChild(info);
  card.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const openBtn = document.createElement('button');
  openBtn.textContent = 'Abrir';
  openBtn.classList.add('primary');
  openBtn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    await openItem(item, type);
  });
  const linkBtn = document.createElement('button');
  linkBtn.textContent = 'Copiar URL';
  linkBtn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    try {
      const url = await getSignedUrl(item.key);
      await navigator.clipboard.writeText(url);
      showToast('Enlace copiado', 'success');
    } catch (error) {
      console.error(error);
      showToast('No se pudo copiar el enlace', 'error');
    }
  });
  const downloadBtn = document.createElement('button');
  downloadBtn.textContent = 'Descargar';
  downloadBtn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    try {
      const url = await getSignedUrl(item.key);
      await window.electronAPI.openExternal(url);
    } catch (error) {
      console.error(error);
      showToast('No se pudo abrir el enlace', 'error');
    }
  });
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Eliminar';
  deleteBtn.classList.add('danger');
  deleteBtn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    if (!confirm(`¿Eliminar ${item.key}?`)) return;
    try {
      await window.electronAPI.deleteObject(item.key);
      await refresh();
      showToast('Objeto eliminado', 'success');
    } catch (error) {
      console.error(error);
      showToast('No se pudo eliminar', 'error');
    }
  });
  actions.append(openBtn, linkBtn, downloadBtn, deleteBtn);
  card.appendChild(actions);

  card.addEventListener('click', async () => {
    await openItem(item, type);
  });

  observePreview(card, preview, item, type);
  grid.appendChild(card);
}

async function getSignedUrl(key: string) {
  const { url } = await window.electronAPI.getSignedUrl(key);
  return url;
}

function observePreview(card: HTMLElement, container: HTMLElement, item: R2ObjectSummary, type: ItemType) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          void loadPreview(container, item, type);
        }
      });
    },
    { threshold: 0.2 }
  );
  observer.observe(card);
}

async function loadPreview(container: HTMLElement, item: R2ObjectSummary, type: ItemType) {
  const cached = await window.electronAPI.getThumbnail(state.bucket, item.key, item.eTag);
  if (cached) {
    renderPreview(container, cached, type);
    return;
  }
  try {
    const url = await getSignedUrl(item.key);
    if (type === 'image') {
      const dataUrl = await captureImage(url);
      renderPreview(container, dataUrl, type);
      await window.electronAPI.saveThumbnail(state.bucket, item.key, item.eTag, dataUrl);
    } else if (type === 'video') {
      const dataUrl = await captureVideoFrame(url);
      renderPreview(container, dataUrl, type);
      await window.electronAPI.saveThumbnail(state.bucket, item.key, item.eTag, dataUrl);
    } else {
      container.textContent = 'Sin vista previa';
    }
  } catch (error) {
    console.error('preview error', error);
    container.textContent = 'Vista previa no disponible';
  }
}

function renderPreview(container: HTMLElement, dataUrl: string, type: ItemType) {
  container.innerHTML = '';
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = 'preview';
  if (type === 'video') {
    const badge = document.createElement('span');
    badge.textContent = '▶';
    badge.style.position = 'absolute';
    badge.style.right = '8px';
    badge.style.bottom = '8px';
    badge.style.background = 'rgba(0,0,0,0.6)';
    badge.style.padding = '2px 6px';
    badge.style.borderRadius = '999px';
    container.appendChild(img);
    container.appendChild(badge);
  } else {
    container.appendChild(img);
  }
}

async function captureImage(url: string): Promise<string> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.referrerPolicy = 'no-referrer';
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  const maxWidth = 400;
  const scale = Math.min(1, maxWidth / img.width);
  canvas.width = Math.max(1, Math.floor(img.width * scale));
  canvas.height = Math.max(1, Math.floor(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas no soportado');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

async function captureVideoFrame(url: string): Promise<string> {
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.src = url;
  video.crossOrigin = 'anonymous';
  video.muted = true;
  await new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      video.currentTime = 0.1;
    };
    const onSeeked = () => resolve();
    const onError = () => reject(new Error('No se pudo cargar el video'));
    video.addEventListener('loadeddata', onLoaded, { once: true });
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
  const canvas = document.createElement('canvas');
  const maxWidth = 400;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  canvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas no soportado');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

async function openItem(item: R2ObjectSummary, type: ItemType) {
  try {
    const url = await getSignedUrl(item.key);
    const modal = document.createElement('div');
    modal.className = 'modal';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.textContent = item.key;
    const close = document.createElement('button');
    close.textContent = 'Cerrar';
    close.addEventListener('click', () => modal.remove());
    header.append(title, close);
    dialog.appendChild(header);
    if (type === 'image') {
      const img = document.createElement('img');
      img.src = url;
      dialog.appendChild(img);
    } else if (type === 'video') {
      const video = document.createElement('video');
      video.src = url;
      video.controls = true;
      video.autoplay = true;
      dialog.appendChild(video);
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.textContent = 'Abrir archivo';
      link.target = '_blank';
      dialog.appendChild(link);
    }
    modal.appendChild(dialog);
    document.body.appendChild(modal);
  } catch (error) {
    console.error(error);
    showToast('No se pudo abrir el objeto', 'error');
  }
}

async function fetchList(options: { prefix?: string; token?: string } = {}) {
  state.loading = true;
  try {
    const prefix = options.prefix ?? state.prefix;
    const response = await window.electronAPI.listObjects({
      prefix,
      continuationToken: options.token,
      search: state.search
    });
    applyResponse(response, prefix);
  } catch (error) {
    console.error(error);
    showToast('Error al cargar objetos', 'error');
  } finally {
    state.loading = false;
    updatePaginationControls();
  }
}

function applyResponse(response: ListResponse, prefix: string) {
  state.bucket = response.bucket;
  if (!state.rootPrefix) {
    state.rootPrefix = response.prefix;
  }
  state.prefix = prefix;
  state.objects = response.objects;
  state.commonPrefixes = response.commonPrefixes;
  state.currentToken = response.continuationToken;
  state.nextContinuationToken = response.nextContinuationToken;
  knownPrefixes.add(prefix);
  response.commonPrefixes.forEach((p) => knownPrefixes.add(p));
  buildBreadcrumbs();
  buildTree();
  renderObjects();
}

function renderObjects() {
  clearGrid();
  const prefixes = state.commonPrefixes.filter((p) => p !== state.prefix).sort();
  if (!prefixes.length && !state.objects.length) {
    renderEmptyState('Carpeta vacía');
    return;
  }

  prefixes.forEach((prefix) => {
    const card = document.createElement('div');
    card.className = 'card';
    const preview = document.createElement('div');
    preview.className = 'preview';
    preview.textContent = '📁';
    card.appendChild(preview);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = relativePrefix(prefix).split('/').filter(Boolean).slice(-1)[0] || prefix;
    const info = document.createElement('div');
    info.className = 'info';
    info.textContent = 'Carpeta';
    meta.append(name, info);
    card.appendChild(meta);
    card.addEventListener('click', () => goToPrefix(prefix));
    grid.appendChild(card);
  });

  state.objects.forEach((object) => createCard(object));
}

async function goToPrefix(prefix: string) {
  state.prefix = prefix;
  state.currentToken = undefined;
  state.nextContinuationToken = undefined;
  state.history = [];
  await fetchList({ prefix });
}

async function refresh() {
  await fetchList({ prefix: state.prefix, token: state.currentToken });
}

function handleSearchInput() {
  const value = searchInput.value.trim();
  state.search = value;
  if (searchDebounce) window.clearTimeout(searchDebounce);
  searchDebounce = window.setTimeout(() => {
    state.history = [];
    state.currentToken = undefined;
    state.nextContinuationToken = undefined;
    fetchList({ prefix: state.prefix });
  }, 300);
}

function setupEvents() {
  document.getElementById('refresh')?.addEventListener('click', () => refresh());
  document.getElementById('new-folder')?.addEventListener('click', async () => {
    const folder = prompt('Nombre de la nueva carpeta');
    if (!folder) return;
    try {
      await window.electronAPI.createFolder(state.prefix, folder);
      showToast('Carpeta creada', 'success');
      await fetchList({ prefix: state.prefix });
    } catch (error) {
      console.error(error);
      showToast('No se pudo crear la carpeta', 'error');
    }
  });
  document.getElementById('diagnostics')?.addEventListener('click', async () => {
    try {
      const report = await window.electronAPI.diagnostics();
      const modal = document.createElement('div');
      modal.className = 'modal';
      const dialog = document.createElement('div');
      dialog.className = 'dialog';
      const header = document.createElement('header');
      const title = document.createElement('h2');
      title.textContent = 'Diagnóstico';
      const close = document.createElement('button');
      close.textContent = 'Cerrar';
      close.addEventListener('click', () => modal.remove());
      header.append(title, close);
      dialog.appendChild(header);
      const list = document.createElement('ul');
      report.details.forEach((detail) => {
        const li = document.createElement('li');
        li.textContent = detail;
        list.appendChild(li);
      });
      dialog.appendChild(list);
      modal.appendChild(dialog);
      document.body.appendChild(modal);
    } catch (error) {
      console.error(error);
      showToast('Error en diagnóstico', 'error');
    }
  });
  searchInput.addEventListener('input', handleSearchInput);
  prevBtn.addEventListener('click', () => {
    if (!state.history.length) return;
    const previousToken = state.history.pop();
    fetchList({ prefix: state.prefix, token: previousToken || undefined });
  });
  nextBtn.addEventListener('click', () => {
    if (state.nextContinuationToken) {
      state.history.push(state.currentToken);
      fetchList({ prefix: state.prefix, token: state.nextContinuationToken });
    }
  });

  const main = document.getElementById('main')!;
  main.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'modal';
      overlay.style.background = 'rgba(15, 19, 28, 0.65)';
      overlay.textContent = 'Suelta archivos para subir';
      document.body.appendChild(overlay);
    }
  });
  main.addEventListener('dragleave', (ev) => {
    if (ev.target === main && overlay) {
      overlay.remove();
      overlay = null;
    }
  });
  main.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    const files = Array.from(ev.dataTransfer?.files ?? []);
    if (!files.length) return;
    for (const file of files) {
      const fileInfo = file as File & { path?: string };
      const filePath = fileInfo.path;
      if (!filePath) continue;
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      uploadMap.set(id, { id, key: file.name, loaded: 0 });
      renderUploadOverlay();
      showToast(`Subiendo ${file.name}`, 'info');
      window.electronAPI
        .uploadObject(state.prefix, filePath, file.name, id)
        .then((result) => {
          const tracker = uploadMap.get(result.id);
          if (tracker) {
            tracker.key = result.key;
          }
        })
        .catch((error) => {
          console.error(error);
          uploadMap.delete(id);
          renderUploadOverlay();
          showToast(`Error subiendo ${file.name}`, 'error');
        });
    }
  });

  window.addEventListener('keydown', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    if (ev.key === 'Backspace') {
      ev.preventDefault();
      goUp();
    } else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      if (state.history.length) {
        const previousToken = state.history.pop();
        fetchList({ prefix: state.prefix, token: previousToken || undefined });
      }
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      if (state.nextContinuationToken) {
        state.history.push(state.currentToken);
        fetchList({ prefix: state.prefix, token: state.nextContinuationToken });
      }
    } else if (ev.key === 'Enter') {
      const firstCard = grid.querySelector('.card[data-key]') as HTMLElement | null;
      if (firstCard) {
        ev.preventDefault();
        const key = firstCard.dataset.key!;
        const item = state.objects.find((obj) => obj.key === key);
        if (item) {
          void openItem(item, detectType(item));
        }
      }
    }
  });

  window.electronAPI.onUploadProgress((progress: UploadProgress) => {
    const tracker = uploadMap.get(progress.id) || { id: progress.id, key: progress.key, loaded: 0 };
    tracker.key = progress.key;
    tracker.loaded = progress.loaded;
    tracker.total = progress.total;
    uploadMap.set(progress.id, tracker);
    if (progress.total && progress.loaded >= progress.total) {
      setTimeout(() => {
        uploadMap.delete(progress.id);
        renderUploadOverlay();
        refresh();
        showToast(`Subida completada: ${progress.key}`, 'success');
      }, 500);
    } else {
      renderUploadOverlay();
    }
  });
}

function goUp() {
  const relative = relativePrefix(state.prefix);
  const parts = relative.split('/').filter(Boolean);
  if (!parts.length) return;
  parts.pop();
  const newPrefix = parts.reduce((acc, part) => `${acc}${acc.endsWith('/') || !acc ? '' : '/'}${part}/`, state.rootPrefix);
  void goToPrefix(newPrefix);
}

function renderUploadOverlay() {
  let container = document.querySelector('.upload-overlay') as HTMLElement | null;
  if (!uploadMap.size) {
    container?.remove();
    return;
  }
  if (!container) {
    container = document.createElement('div');
    container.className = 'upload-overlay';
    const list = document.createElement('div');
    list.className = 'list';
    container.appendChild(list);
    document.body.appendChild(container);
  }
  const list = container.querySelector('.list') as HTMLElement;
  list.innerHTML = '';
  uploadMap.forEach((item) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.flexDirection = 'column';
    row.style.gap = '6px';
    const label = document.createElement('span');
    label.textContent = item.key.split('/').slice(-1)[0];
    const progress = document.createElement('div');
    progress.className = 'progress';
    const inner = document.createElement('span');
    const total = item.total ?? 0;
    const ratio = total ? Math.min(100, Math.round((item.loaded / total) * 100)) : 0;
    inner.style.width = `${ratio}%`;
    progress.appendChild(inner);
    row.append(label, progress);
    list.appendChild(row);
  });
}

async function bootstrap() {
  setupEvents();
  await fetchList({ prefix: state.prefix });
  const publicBase = await window.electronAPI.readPublicBase();
  if (publicBase) {
    showToast(`Base pública: ${publicBase}`, 'info', 5000);
  }
}

bootstrap().catch((error) => {
  console.error(error);
  showToast('Error inicializando la app', 'error');
});

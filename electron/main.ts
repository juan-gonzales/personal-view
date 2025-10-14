import path from 'node:path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import {
  ListObjectsV2Command,
  _Object,
  ListObjectsV2CommandOutput,
  HeadObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  GetObjectCommand
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { getR2Client, getR2Config } from '../src/shared/r2';

dotenv.config();

const r2Config = getR2Config();
const r2Client = getR2Client();

const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;

let mainWindow: BrowserWindow | null = null;

const CHANNELS = {
  LIST: 'r2:list',
  SIGN: 'r2:sign',
  THUMB_GET: 'thumb:get',
  THUMB_SAVE: 'thumb:save',
  THUMB_CLEAR: 'thumb:clear',
  UPLOAD: 'r2:upload',
  UPLOAD_PROGRESS: 'r2:upload:progress',
  CREATE_FOLDER: 'r2:create-folder',
  DELETE_OBJECT: 'r2:delete-object',
  OPEN_EXTERNAL: 'system:open-external',
  DIAG: 'r2:diagnostics',
  PUBLIC_BASE: 'r2:public-base'
} as const;

function assertString(input: unknown, label: string): string {
  if (typeof input !== 'string') {
    throw new Error(`${label} debe ser string`);
  }
  return input;
}

function getThumbDir(): string {
  const dir = path.join(app.getPath('userData'), 'cache', 'thumbs');
  if (!existsSync(dir)) {
    fs.mkdir(dir, { recursive: true }).catch(() => {
      /* ignore */
    });
  }
  return dir;
}

function getThumbPath(bucket: string, key: string, eTag: string): string {
  const hash = crypto.createHash('sha1').update(`${bucket}:${key}:${eTag}`).digest('hex');
  return path.join(getThumbDir(), `${hash}.png`);
}

async function ensureClientReady() {
  if (!r2Config.bucket) {
    throw new Error('R2_BUCKET no configurado');
  }
  if (!r2Config.accountId) {
    throw new Error('R2_ACCOUNT_ID no configurado');
  }
}

async function listObjects(prefix: string, continuationToken?: string, search?: string): Promise<ListObjectsV2CommandOutput> {
  await ensureClientReady();
  const response = await r2Client.send(
    new ListObjectsV2Command({
      Bucket: r2Config.bucket,
      Prefix: prefix,
      Delimiter: '/',
      ContinuationToken: continuationToken || undefined
    })
  );
  if (search && search.trim()) {
    const term = search.trim().toLowerCase();
    response.Contents = (response.Contents || []).filter((item) => item.Key?.toLowerCase().includes(term));
    response.CommonPrefixes = (response.CommonPrefixes || []).filter((item) => item.Prefix?.toLowerCase().includes(term));
  }
  return response;
}

async function readContentType(object: _Object): Promise<string | undefined> {
  if (!object.Key) return undefined;
  try {
    const head = await r2Client.send(new HeadObjectCommand({ Bucket: r2Config.bucket, Key: object.Key }));
    return head.ContentType || undefined;
  } catch (error) {
    console.warn('HeadObject failed', error);
    return undefined;
  }
}

async function withContentTypes(objects: _Object[]): Promise<_Object[]> {
  const results: _Object[] = new Array(objects.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(8, objects.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= objects.length) break;
      const object = objects[index];
      const contentType = await readContentType(object);
      if (contentType) {
        object.Metadata = { ...(object.Metadata || {}), contentType };
      }
      results[index] = object;
    }
  });
  await Promise.all(workers);
  return results;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#111111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow().catch((err) => {
    console.error('Failed to create window', err);
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((err) => console.error(err));
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle(CHANNELS.LIST, async (_event, payload) => {
  const { prefix, continuationToken, search } = payload as { prefix?: unknown; continuationToken?: unknown; search?: unknown };
  const safePrefix = typeof prefix === 'string' ? prefix : '';
  const safeToken = typeof continuationToken === 'string' ? continuationToken : undefined;
  const safeSearch = typeof search === 'string' ? search : undefined;
  const effectivePrefix = safePrefix || r2Config.startPrefix;
  const response = await listObjects(effectivePrefix, safeToken, safeSearch);
  const objects = await withContentTypes(response.Contents || []);
  return {
    bucket: r2Config.bucket,
    prefix: effectivePrefix,
    objects: objects
      .filter((item): item is _Object & { Key: string } => Boolean(item.Key))
      .map((item) => ({
        key: item.Key!,
        size: item.Size ?? 0,
        eTag: item.ETag ?? '',
        lastModified: item.LastModified?.toISOString(),
        contentType: item.Metadata?.contentType
      })),
    commonPrefixes: (response.CommonPrefixes || []).map((item) => item.Prefix).filter(Boolean) as string[],
    continuationToken: response.ContinuationToken,
    nextContinuationToken: response.NextContinuationToken
  };
});

ipcMain.handle(CHANNELS.SIGN, async (_event, payload) => {
  await ensureClientReady();
  const key = assertString(payload, 'key');
  const signed = await getSignedUrl(r2Client, new GetObjectCommand({ Bucket: r2Config.bucket, Key: key }), {
    expiresIn: r2Config.signedUrlTtl
  });
  const expiresAt = Date.now() + r2Config.signedUrlTtl * 1000;
  return { url: signed, expiresAt };
});

ipcMain.handle(CHANNELS.THUMB_GET, async (_event, payload) => {
  const { bucket, key, eTag } = payload as { bucket?: unknown; key?: unknown; eTag?: unknown };
  if (typeof bucket !== 'string' || typeof key !== 'string' || typeof eTag !== 'string') return null;
  const file = getThumbPath(bucket, key, eTag);
  if (!existsSync(file)) return null;
  const buffer = await fs.readFile(file);
  return `data:image/png;base64,${buffer.toString('base64')}`;
});

ipcMain.handle(CHANNELS.THUMB_SAVE, async (_event, payload) => {
  const { bucket, key, eTag, dataUrl } = payload as { bucket?: unknown; key?: unknown; eTag?: unknown; dataUrl?: unknown };
  if (typeof bucket !== 'string' || typeof key !== 'string' || typeof eTag !== 'string' || typeof dataUrl !== 'string') return;
  const base64 = dataUrl.split(',')[1];
  if (!base64) return;
  const buffer = Buffer.from(base64, 'base64');
  await fs.mkdir(getThumbDir(), { recursive: true });
  await fs.writeFile(getThumbPath(bucket, key, eTag), buffer);
});

ipcMain.handle(CHANNELS.THUMB_CLEAR, async (_event, payload) => {
  const { bucket, key, eTag } = payload as { bucket?: unknown; key?: unknown; eTag?: unknown };
  if (typeof bucket !== 'string' || typeof key !== 'string' || typeof eTag !== 'string') return;
  const file = getThumbPath(bucket, key, eTag);
  if (existsSync(file)) {
    await fs.unlink(file).catch(() => undefined);
  }
});

ipcMain.handle(CHANNELS.UPLOAD, async (event, payload) => {
  await ensureClientReady();
  const { prefix, filePath, fileName, id } = payload as { prefix?: unknown; filePath?: unknown; fileName?: unknown; id?: unknown };
  if (typeof prefix !== 'string' || typeof filePath !== 'string' || typeof fileName !== 'string' || typeof id !== 'string') {
    throw new Error('Parámetros de subida inválidos');
  }
  const key = `${prefix}${prefix.endsWith('/') || !prefix ? '' : '/'}${fileName}`.replace(/\\/g, '/');
  const upload = new Upload({
    client: r2Client,
    params: {
      Bucket: r2Config.bucket,
      Key: key,
      Body: createReadStream(filePath)
    }
  });
  upload.on('httpUploadProgress', (progress) => {
    event.sender.send(CHANNELS.UPLOAD_PROGRESS, {
      id,
      key,
      loaded: progress.loaded ?? 0,
      total: progress.total
    });
  });
  await upload.done();
  return { key };
});

ipcMain.handle(CHANNELS.CREATE_FOLDER, async (_event, payload) => {
  await ensureClientReady();
  const { prefix, folderName } = payload as { prefix?: unknown; folderName?: unknown };
  if (typeof prefix !== 'string' || typeof folderName !== 'string') {
    throw new Error('Parámetros inválidos');
  }
  const safeFolder = folderName.trim().replace(/\/+$/g, '');
  if (!safeFolder) throw new Error('Nombre inválido');
  const key = `${prefix}${prefix.endsWith('/') || !prefix ? '' : '/'}${safeFolder}/.keep`;
  await r2Client.send(new PutObjectCommand({ Bucket: r2Config.bucket, Key: key, Body: '' }));
  return { key };
});

ipcMain.handle(CHANNELS.DELETE_OBJECT, async (_event, payload) => {
  await ensureClientReady();
  const key = assertString(payload, 'key');
  await r2Client.send(new DeleteObjectCommand({ Bucket: r2Config.bucket, Key: key }));
});

ipcMain.handle(CHANNELS.OPEN_EXTERNAL, async (_event, payload) => {
  const url = assertString(payload, 'url');
  await shell.openExternal(url);
});

ipcMain.handle(CHANNELS.PUBLIC_BASE, async () => {
  return r2Config.publicBase;
});

ipcMain.handle(CHANNELS.DIAG, async () => {
  const details: string[] = [];
  try {
    await ensureClientReady();
    details.push('Configuración cargada');
    const test = await r2Client.send(new ListObjectsV2Command({ Bucket: r2Config.bucket, MaxKeys: 1 }));
    details.push(`ListObjectsV2 OK (${test.KeyCount ?? 0} objetos)`);
    const key = test.Contents?.[0]?.Key;
    if (key) {
      const signed = await getSignedUrl(r2Client, new GetObjectCommand({ Bucket: r2Config.bucket, Key: key }), { expiresIn: 60 });
      details.push(`Presign OK para ${key}`);
      details.push(`URL: ${signed.substring(0, 80)}...`);
    } else {
      details.push('Bucket vacío, presign omitido');
    }
    await fs.mkdir(getThumbDir(), { recursive: true });
    details.push('Directorio de caché verificado');
    return { ok: true, details };
  } catch (error) {
    details.push(String(error));
    return { ok: false, details };
  }
});

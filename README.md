# Personal View

Visor de imágenes y videos para Cloudflare R2 construido con Electron + TypeScript. Permite explorar buckets, generar miniaturas locales y reproducir contenido mediante URLs firmadas.

## Requisitos

- Node.js 18+
- Cuenta y bucket en Cloudflare R2 con credenciales S3.

## Configuración

1. Instala dependencias:

   ```bash
   npm install
   ```

2. Copia `.env.example` a `.env` y completa las variables:

   ```bash
   cp .env.example .env
   ```

   | Variable | Descripción |
   |----------|-------------|
   | `R2_ACCOUNT_ID` | ID de cuenta R2 (usado en el endpoint). |
   | `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Credenciales de acceso S3. |
   | `R2_BUCKET` | Nombre del bucket a explorar. |
   | `R2_SIGNED_URL_TTL_SECONDS` | (Opcional) TTL en segundos para URLs firmadas (default 7 días). |
   | `R2_START_PREFIX` | (Opcional) Prefijo inicial al abrir la app. |
   | `R2_PUBLIC_BASE` | (Opcional) Base pública para mostrar en el UI. |

## Scripts

- `npm run dev`: arranca Vite (renderer), compila el proceso principal en modo watch y abre Electron.
- `npm run build`: compila el main (`tsc`), el renderer (`vite build`) y empaqueta con `electron-builder`.
- `npm run typecheck`: valida tipos TypeScript en el renderer.

Durante el desarrollo se generan los bundles en `dist-electron/` (main/preload) y `dist/renderer/` (UI).

## Funcionalidades

- Exploración por prefijos con breadcrumbs y árbol lateral.
- Búsqueda por prefijo, paginación (ListObjectsV2) y atajos de teclado (`←/→` páginas, `Enter` abre el primer elemento, `Backspace` sube de nivel).
- Miniaturas locales para imágenes y videos, guardadas en `app.getPath('userData')/cache/thumbs/` (hash por bucket/clave/etag).
- Previsualización y reproducción con URLs firmadas (GetObject + presign con AWS SDK v3).
- Acciones por objeto: abrir en modal, descargar (URL firmada), copiar enlace, eliminar.
- Subida mediante drag & drop con progreso (PutObject).
- Creación de “carpetas” (sube `.keep`) y diagnóstico rápido (List + presign + caché).
- Modo oscuro minimalista, toasts de errores/éxitos y manejo básico de errores de red.

## Caché de miniaturas

Las miniaturas se generan en el renderer (canvas) y se guardan como PNG en el disco local. La clave de caché es `sha1(bucket:key:etag)` para invalidar automáticamente cuando cambia el objeto.

## Seguridad

El renderer opera sin Node.js (`contextIsolation` y `sandbox` activados). Toda interacción con Cloudflare R2 pasa por IPC seguro expuesto en `electron/preload.ts`.

## Build de producción

Para generar binarios:

```bash
npm run build
```

Los artefactos quedarán en `release/` según la configuración de `electron-builder.yml`.

## Notas

- Las URLs firmadas dependen de `R2_SIGNED_URL_TTL_SECONDS` (por defecto 7 días).
- El diagnóstico en Ajustes intenta listar el bucket, firmar el primer objeto disponible y validar la caché local.
- El modo dev abre las herramientas de desarrollador automáticamente; ciérralas si no las necesitas.

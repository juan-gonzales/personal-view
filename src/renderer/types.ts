export interface R2ObjectSummary {
  key: string;
  size: number;
  eTag: string;
  lastModified?: string;
  contentType?: string;
}

export interface ListResponse {
  bucket: string;
  prefix: string;
  objects: R2ObjectSummary[];
  commonPrefixes: string[];
  continuationToken?: string;
  nextContinuationToken?: string;
}

export interface ListRequest {
  prefix: string;
  continuationToken?: string;
  search?: string;
}

export interface SignedUrlResponse {
  url: string;
  expiresAt: number;
}

export interface UploadProgress {
  id: string;
  key: string;
  loaded: number;
  total?: number;
}

export interface DiagnosticsReport {
  ok: boolean;
  details: string[];
}

export interface ElectronAPI {
  listObjects(request: ListRequest): Promise<ListResponse>;
  getSignedUrl(key: string): Promise<SignedUrlResponse>;
  getThumbnail(bucket: string, key: string, eTag: string): Promise<string | null>;
  saveThumbnail(bucket: string, key: string, eTag: string, dataUrl: string): Promise<void>;
  clearThumbnail(bucket: string, key: string, eTag: string): Promise<void>;
  onUploadProgress(callback: (event: UploadProgress) => void): () => void;
  uploadObject(prefix: string, filePath: string, fileName: string, id: string): Promise<{ key: string; id: string }>;
  createFolder(prefix: string, folderName: string): Promise<{ key: string }>;
  deleteObject(key: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  diagnostics(): Promise<DiagnosticsReport>;
  readPublicBase(): Promise<string>;
}

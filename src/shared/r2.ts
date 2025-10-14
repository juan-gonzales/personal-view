import { S3Client } from '@aws-sdk/client-s3';

export interface R2Config {
  accountId: string;
  bucket: string;
  signedUrlTtl: number;
  startPrefix: string;
  publicBase: string;
}

let client: S3Client | null = null;

export function getR2Config(): R2Config {
  return {
    accountId: process.env.R2_ACCOUNT_ID ?? '',
    bucket: process.env.R2_BUCKET ?? '',
    signedUrlTtl: Number(process.env.R2_SIGNED_URL_TTL_SECONDS ?? '604800'),
    startPrefix: process.env.R2_START_PREFIX ?? '',
    publicBase: process.env.R2_PUBLIC_BASE ?? ''
  };
}

export function getR2Client(): S3Client {
  if (!client) {
    const config = getR2Config();
    client = new S3Client({
      region: 'auto',
      endpoint: config.accountId ? `https://${config.accountId}.r2.cloudflarestorage.com` : undefined,
      forcePathStyle: true,
      credentials:
        process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.R2_ACCESS_KEY_ID,
              secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
            }
          : undefined
    });
  }
  return client;
}

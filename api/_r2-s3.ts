import { S3Client } from '@aws-sdk/client-s3'

let client: S3Client | null = null

export function requireR2Env(): void {
  const missing: string[] = []
  if (!process.env.R2_ENDPOINT) missing.push('R2_ENDPOINT')
  if (!process.env.R2_BUCKET) missing.push('R2_BUCKET')
  if (!process.env.R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID')
  if (!process.env.R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY')
  if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`)
}

export function getR2Bucket(): string {
  requireR2Env()
  return process.env.R2_BUCKET as string
}

export function getR2S3Client(): S3Client {
  requireR2Env()
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
      },
    })
  }
  return client
}

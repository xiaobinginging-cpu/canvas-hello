import { PutObjectCommand } from '@aws-sdk/client-s3'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getR2Bucket, getR2S3Client } from './_r2-s3'

/**
 * POST JSON `{ key, contentType?, base64 }` — base64 body avoids Vercel body-parser edge cases
 * with raw octet streams. V1 payload limit ~4.5MB (platform); oversized uploads fall back to GitHub in the app.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' })
    return
  }

  try {
    const raw = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const key = typeof raw?.key === 'string' ? raw.key.trim() : ''
    const contentType =
      typeof raw?.contentType === 'string' && raw.contentType.trim()
        ? raw.contentType.trim()
        : 'application/octet-stream'
    const base64 = typeof raw?.base64 === 'string' ? raw.base64 : ''
    if (!key || !base64) {
      res.status(400).json({ ok: false, error: 'key and base64 required' })
      return
    }

    const buf = Buffer.from(base64.replace(/\s/g, ''), 'base64')

    await getR2S3Client().send(
      new PutObjectCommand({
        Bucket: getR2Bucket(),
        Key: key,
        Body: buf,
        ContentType: contentType,
        ContentLength: buf.length,
      }),
    )

    res.status(200).json({ ok: true, key })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error'
    console.error('[api/r2-upload]', e)
    res.status(500).json({ ok: false, error: message })
  }
}

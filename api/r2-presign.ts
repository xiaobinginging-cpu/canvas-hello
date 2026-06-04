import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getR2Bucket, getR2S3Client } from './_r2-s3.js'

/**
 * POST JSON `{ key, contentType? }` → `{ url }`：R2 预签名 PUT URL。
 * 浏览器拿到后把 blob **直接 PUT 到 R2**（绕过 Vercel serverless ~4.5MB body 上限，
 * 解决大视频传不上去）。直传需 R2 bucket 配 CORS 允许 PUT。
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
    if (!key) {
      res.status(400).json({ ok: false, error: 'missing key' })
      return
    }

    const url = await getSignedUrl(
      getR2S3Client(),
      new PutObjectCommand({ Bucket: getR2Bucket(), Key: key, ContentType: contentType }),
      { expiresIn: 300 },
    )

    res.status(200).json({ ok: true, url })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error'
    console.error('[api/r2-presign]', e)
    res.status(500).json({ ok: false, error: message })
  }
}

import { GetObjectCommand } from '@aws-sdk/client-s3'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getR2Bucket, getR2S3Client } from './_r2-s3.js'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method not allowed' })
    return
  }

  try {
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const key = (url.searchParams.get('key') || '').trim()
    if (!key) {
      res.status(400).json({ ok: false, error: 'missing key' })
      return
    }

    const out = await getR2S3Client().send(
      new GetObjectCommand({
        Bucket: getR2Bucket(),
        Key: key,
      }),
    )

    const ct = out.ContentType || 'application/octet-stream'
    const body = out.Body
    if (!body || typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray !== 'function') {
      res.status(500).json({ ok: false, error: 'empty body' })
      return
    }

    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray()
    res
      .status(200)
      .setHeader('Content-Type', ct)
      .setHeader('Cache-Control', 'no-store')
      .send(Buffer.from(bytes))
  } catch (e: unknown) {
    const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : ''
    if (name === 'NoSuchKey' || name === 'NotFound') {
      res.status(404).json({ ok: false, error: 'not found' })
      return
    }
    const message = e instanceof Error ? e.message : 'unknown error'
    console.error('[api/r2-fetch]', e)
    res.status(500).json({ ok: false, error: message })
  }
}

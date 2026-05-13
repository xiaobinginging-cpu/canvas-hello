import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getR2Bucket, getR2S3Client } from './_r2-s3'

const BATCH = 1000

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' })
    return
  }

  try {
    const raw = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const prefix = typeof raw?.prefix === 'string' ? raw.prefix.trim() : ''
    const keysIn = raw?.keys

    const client = getR2S3Client()
    const bucket = getR2Bucket()

    let keys: string[] = []
    if (Array.isArray(keysIn)) {
      keys = keysIn.filter((k): k is string => typeof k === 'string').map((k) => k.trim()).filter(Boolean)
    } else if (prefix) {
      let continuationToken: string | undefined
      do {
        const listed = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        )
        for (const o of listed.Contents ?? []) {
          if (o.Key) keys.push(o.Key)
        }
        continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined
      } while (continuationToken)
    } else {
      res.status(400).json({ ok: false, error: 'prefix or keys required' })
      return
    }

    let deleted = 0
    for (let i = 0; i < keys.length; i += BATCH) {
      const chunk = keys.slice(i, i + BATCH)
      const resp = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: chunk.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      )
      deleted += chunk.length - (resp.Errors?.length ?? 0)
      if (resp.Errors?.length) {
        console.warn('[api/r2-delete] partial errors', resp.Errors)
      }
    }

    res.status(200).json({ ok: true, deleted, total: keys.length })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error'
    console.error('[api/r2-delete]', e)
    res.status(500).json({ ok: false, error: message })
  }
}

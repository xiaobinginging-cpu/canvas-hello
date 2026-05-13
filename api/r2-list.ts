import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getR2Bucket, getR2S3Client } from './_r2-s3'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method not allowed' })
    return
  }

  try {
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const prefix = (url.searchParams.get('prefix') ?? 'project-').trim()
    const delimiter = (url.searchParams.get('delimiter') ?? '/').trim()

    const commonPrefixes: string[] = []
    const objects: { key: string; size?: number; lastModified?: string }[] = []

    let continuationToken: string | undefined

    do {
      const page = await getR2S3Client().send(
        new ListObjectsV2Command({
          Bucket: getR2Bucket(),
          Prefix: prefix,
          Delimiter: delimiter || undefined,
          ContinuationToken: continuationToken,
        }),
      )

      for (const p of page.CommonPrefixes ?? []) {
        if (p.Prefix) commonPrefixes.push(p.Prefix)
      }
      for (const o of page.Contents ?? []) {
        if (o.Key) {
          objects.push({
            key: o.Key,
            size: o.Size,
            lastModified: o.LastModified?.toISOString(),
          })
        }
      }

      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (continuationToken)

    res.status(200).json({ ok: true, commonPrefixes, objects })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'unknown error'
    console.error('[api/r2-list]', e)
    res.status(500).json({ ok: false, error: message })
  }
}

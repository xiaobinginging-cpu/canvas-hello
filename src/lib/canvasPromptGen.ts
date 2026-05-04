import { nanoid } from 'nanoid'
import { collectReferenceBlobs } from './canvasGeneration.ts'
import { persistCanvasNow } from './canvasPersist.ts'
import { generatePromptFromImages } from './promptGen.ts'
import type { PromptGenAPI, PromptGenModel } from './promptGen.ts'
import type { TextCard } from '../types/project.ts'
import { useProjectStore } from '../store/useStore.ts'

const DEFAULT_CARD_W = 400
const DEFAULT_CARD_H = 300

const PLACEHOLDER_TEXT = '生成中…'

export async function runCanvasPromptGeneration(opts: {
  api: PromptGenAPI
  model: PromptGenModel
  imageIds: string[]
  instruction?: string
}): Promise<void> {
  const { api, model, imageIds, instruction } = opts
  const imageCount = imageIds.length
  console.log(`[prompt-gen] start api=${api} model=${model} imageCount=${imageCount}`)

  const st0 = useProjectStore.getState()
  const canvas = st0.currentProjectCanvas
  const firstId = imageIds[0]
  const anchor = canvas?.images.find((i) => i.id === firstId)
  const x = anchor ? anchor.position.x + anchor.size.w + 30 : 120
  const y = anchor ? anchor.position.y : 120

  const now = Date.now()
  const cardId = nanoid()
  const source: TextCard['source'] = {
    kind: 'prompt-gen',
    sourceImageIds: [...imageIds],
    api,
    model,
    instruction: instruction?.trim() ? instruction.trim() : undefined,
    generatedAt: now,
  }

  const placeholderCard: TextCard = {
    id: cardId,
    x,
    y,
    width: DEFAULT_CARD_W,
    height: DEFAULT_CARD_H,
    text: PLACEHOLDER_TEXT,
    source,
    createdAt: now,
  }

  st0.addTextCard(placeholderCard)

  const instrTrim = instruction?.trim()
  let blobs: Blob[] = []
  if (imageIds.length > 0) {
    const refs = await collectReferenceBlobs(imageIds)
    blobs = refs.map((r) => r.blob)
    if (blobs.length === 0) {
      const msg = '无法加载参考图'
      console.error('[prompt-gen] error →', msg)
      useProjectStore.getState().patchTextCard(cardId, { text: `生成失败：${msg}` })
      await persistCanvasNow()
      useProjectStore.getState().clearPromptGenImageIds()
      return
    }
  }

  if (blobs.length === 0 && !instrTrim) {
    const msg = '需要参考图或自定义 instruction'
    useProjectStore.getState().patchTextCard(cardId, { text: `生成失败：${msg}` })
    await persistCanvasNow()
    useProjectStore.getState().clearPromptGenImageIds()
    return
  }

  let text: string
  try {
    text = await generatePromptFromImages({
      api,
      model,
      imageBlobs: blobs,
      instruction,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[prompt-gen] error →', msg)
    useProjectStore.getState().patchTextCard(cardId, { text: `生成失败：${msg}` })
    await persistCanvasNow()
    useProjectStore.getState().clearPromptGenImageIds()
    return
  }

  console.log(`[prompt-gen] api response received textLength=${text.length}`)

  useProjectStore.getState().patchTextCard(cardId, { text })

  console.log(`[prompt-gen] text card filled id=${cardId}`)

  await persistCanvasNow()

  useProjectStore.getState().clearPromptGenImageIds()
}

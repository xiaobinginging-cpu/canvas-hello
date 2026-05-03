import { nanoid } from 'nanoid'
import { collectReferenceBlobs } from './canvasGeneration.ts'
import { persistCanvasNow } from './canvasPersist.ts'
import { generatePromptFromImages } from './promptGen.ts'
import type { PromptGenAPI, PromptGenModel } from './promptGen.ts'
import type { TextCard } from '../types/project.ts'
import { useProjectStore } from '../store/useStore.ts'

const DEFAULT_CARD_W = 400
const DEFAULT_CARD_H = 300

export async function runCanvasPromptGeneration(opts: {
  api: PromptGenAPI
  model: PromptGenModel
  imageIds: string[]
  instruction?: string
}): Promise<void> {
  const { api, model, imageIds, instruction } = opts
  const imageCount = imageIds.length
  console.log(`[prompt-gen] start api=${api} model=${model} imageCount=${imageCount}`)

  const refs = await collectReferenceBlobs(imageIds)
  const blobs = refs.map((r) => r.blob)
  if (blobs.length === 0) {
    const err = new Error('No image blobs available for prompt generation')
    console.error('[prompt-gen] error →', err)
    throw err
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
    throw e
  }

  console.log(`[prompt-gen] api response received textLength=${text.length}`)

  const state = useProjectStore.getState()
  const canvas = state.currentProjectCanvas
  const firstId = imageIds[0]
  const anchor = canvas?.images.find((i) => i.id === firstId)
  const x = anchor ? anchor.position.x + anchor.size.w + 30 : 120
  const y = anchor ? anchor.position.y : 120

  const now = Date.now()
  const card: TextCard = {
    id: nanoid(),
    x,
    y,
    width: DEFAULT_CARD_W,
    height: DEFAULT_CARD_H,
    text,
    source: {
      kind: 'prompt-gen',
      sourceImageIds: [...imageIds],
      api,
      model,
      instruction: instruction?.trim() ? instruction.trim() : undefined,
      generatedAt: now,
    },
    createdAt: now,
  }

  state.addTextCard(card)

  console.log(`[prompt-gen] text card created id=${card.id} position=(${card.x},${card.y})`)

  await persistCanvasNow()

  state.clearPromptGenImageIds()
  state.setSelectedTool('cursor')
}

import { useState } from 'react'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { Handle, Position, useReactFlow } from 'reactflow'
import type { Node, NodeProps } from 'reactflow'

type GeminiInlinePart = {
  inlineData: {
    mimeType: string
    data: string
  }
}

type GeminiTextPart = {
  text: string
}

function stripPrefix(value: string): { mimeType: string; data: string } | null {
  const dataUrlMatch = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (dataUrlMatch) {
    return { mimeType: dataUrlMatch[1], data: dataUrlMatch[2] }
  }

  if (!value.trim()) return null
  return { mimeType: 'image/png', data: value }
}

function ImageToPromptNode({ id, data, xPos, yPos }: NodeProps) {
  const [guidancePrompt, setGuidancePrompt] = useState(
    typeof data?.label === 'string' ? data.label : '',
  )
  const [isRunning, setIsRunning] = useState(false)
  const { getEdges, getNodes, setNodes, setEdges } = useReactFlow()

  const runVisionQa = async () => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY
    if (!apiKey) {
      console.error('Missing VITE_GEMINI_API_KEY')
      return
    }

    setIsRunning(true)
    try {
      const edges = getEdges()
      const nodes = getNodes()
      const upstreamSourceIds = edges
        .filter((edge) => edge.target === id)
        .map((edge) => edge.source)

      const upstreamNodes = upstreamSourceIds
        .map((sourceId) => nodes.find((node) => node.id === sourceId))
        .filter((node): node is Node => Boolean(node))

      const parts: Array<GeminiTextPart | GeminiInlinePart> = []
      const finalPrompt = guidancePrompt.trim() || '请详细描述这张图片'
      parts.push({ text: finalPrompt })

      upstreamNodes.forEach((node) => {
        const nodeType = node.type ?? ''
        if (nodeType !== 'imageInput' && nodeType !== 'imageNode') return

        const imageValue =
          typeof node.data?.content === 'string'
            ? node.data.content
            : typeof node.data?.imageUrl === 'string'
              ? node.data.imageUrl
              : ''

        const parsed = stripPrefix(imageValue)
        if (parsed) {
          parts.push({
            inlineData: {
              mimeType: parsed.mimeType,
              data: parsed.data,
            },
          })
        }
      })

      const genAI = new GoogleGenerativeAI(apiKey)
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
      const result = await model.generateContent(parts)
      const text = result.response.text()

      const responseId = `prompt-${Date.now()}`
      setNodes((prevNodes) => [
        ...prevNodes,
        {
          id: responseId,
          type: 'custom',
          position: { x: xPos ?? 0, y: (yPos ?? 0) + 250 },
          data: { label: text },
        },
      ])

      setEdges((prevEdges) => [
        ...prevEdges,
        { id: `e-${id}-${responseId}`, source: id, target: responseId },
      ])
    } catch (error) {
      console.error('Vision QA failed:', error)
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        background: '#fff',
        color: '#000',
        border: '2px solid #000',
        fontSize: 14,
        fontFamily: 'monospace',
        minWidth: 280,
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>图片反推 / Vision QA</div>
      <textarea
        className="nodrag nowheel"
        value={guidancePrompt}
        onChange={(event) => setGuidancePrompt(event.target.value)}
        placeholder="可选：'用 10 字描述' / '聚焦光影' / '什么风格？' / 不填默认描述图片"
        style={{
          width: '100%',
          minHeight: 40,
          border: '1px solid #ddd',
          borderRadius: 6,
          padding: 6,
          fontSize: 13,
          fontFamily: 'monospace',
          resize: 'vertical',
        }}
      />
      <button
        className="nodrag"
        onClick={runVisionQa}
        disabled={isRunning}
        style={{
          marginTop: 8,
          background: '#000',
          color: '#fff',
          border: '1px solid #000',
          borderRadius: 6,
          padding: '6px 12px',
          fontSize: 13,
          fontFamily: 'monospace',
          cursor: isRunning ? 'not-allowed' : 'pointer',
          opacity: isRunning ? 0.7 : 1,
        }}
      >
        {isRunning ? '反推中...' : '反推'}
      </button>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

export default ImageToPromptNode

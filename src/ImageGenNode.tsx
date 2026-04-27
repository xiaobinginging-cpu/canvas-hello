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

function ImageGenNode({ id, data, xPos, yPos }: NodeProps) {
  const [prompt, setPrompt] = useState(typeof data?.label === 'string' ? data.label : '')
  const [isGenerating, setIsGenerating] = useState(false)
  const { getEdges, getNodes, setNodes, setEdges } = useReactFlow()

  const runGenerate = async () => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY
    if (!apiKey) {
      console.error('Missing VITE_GEMINI_API_KEY')
      return
    }

    setIsGenerating(true)
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

      upstreamNodes.forEach((node) => {
        const nodeType = node.type ?? ''
        if (nodeType === 'custom' || nodeType === 'input') {
          const textValue =
            typeof node.data?.label === 'string'
              ? node.data.label
              : typeof node.data?.content === 'string'
                ? node.data.content
                : ''
          if (textValue.trim()) {
            parts.push({ text: textValue })
          }
          return
        }

        if (nodeType === 'imageInput' || nodeType === 'imageNode') {
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
        }
      })

      parts.push({ text: prompt })

      const genAI = new GoogleGenerativeAI(apiKey)
      const model = genAI.getGenerativeModel({
        model: 'gemini-3-pro-image-preview',
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
      })
      const result = await model.generateContent(parts)

      const response = result.response as {
        candidates?: Array<{
          content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> }
        }>
      }

      const responseParts = response.candidates?.[0]?.content?.parts ?? []
      const inlinePart = responseParts.find((part) => part.inlineData?.data)
      const imageData = inlinePart?.inlineData?.data
      const mimeType = inlinePart?.inlineData?.mimeType ?? 'image/png'

      if (!imageData) {
        console.error('No image returned from model response.')
        return
      }

      const dataUrl = `data:${mimeType};base64,${imageData}`
      const responseId = `image-${Date.now()}`

      setNodes((prevNodes) => [
        ...prevNodes,
        {
          id: responseId,
          type: 'imageNode',
          position: { x: xPos ?? 0, y: (yPos ?? 0) + 250 },
          data: { label: '生成结果', imageUrl: dataUrl },
        },
      ])

      setEdges((prevEdges) => [
        ...prevEdges,
        { id: `e-${id}-${responseId}`, source: id, target: responseId },
      ])
    } catch (error) {
      console.error('Image generation failed:', error)
    } finally {
      setIsGenerating(false)
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
      <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>图片生成</div>
      <textarea
        className="nodrag nowheel"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="输入图片提示词..."
        style={{
          width: '100%',
          minHeight: 60,
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
        onClick={runGenerate}
        disabled={isGenerating}
        style={{
          marginTop: 8,
          background: '#000',
          color: '#fff',
          border: '1px solid #000',
          borderRadius: 6,
          padding: '6px 12px',
          fontSize: 13,
          fontFamily: 'monospace',
          cursor: isGenerating ? 'not-allowed' : 'pointer',
          opacity: isGenerating ? 0.7 : 1,
        }}
      >
        {isGenerating ? '生成中...' : '生成'}
      </button>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

export default ImageGenNode

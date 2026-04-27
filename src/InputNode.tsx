import { useState } from 'react'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { Handle, Position, useReactFlow } from 'reactflow'
import type { NodeProps } from 'reactflow'

function InputNode({ id, data, xPos, yPos }: NodeProps) {
  const [text, setText] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const { setNodes, setEdges, getEdges, getNodes } = useReactFlow()

  const runPrompt = async () => {
    const userPrompt = text.trim()
    if (!userPrompt) return

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY
    if (!apiKey) {
      console.error('Missing VITE_GEMINI_API_KEY')
      return
    }

    const edges = getEdges()
    const nodes = getNodes()
    const upstreamSourceIds = edges
      .filter((edge) => edge.target === id)
      .map((edge) => edge.source)
    const upstreamContents = upstreamSourceIds
      .map((sourceId) => nodes.find((node) => node.id === sourceId)?.data?.label)
      .filter((label): label is string => typeof label === 'string' && label.trim().length > 0)

    const finalPrompt = upstreamContents.length > 0
      ? `上下文：
${upstreamContents.join('\n---\n')}

用户问题：${userPrompt}`
      : userPrompt

    console.log('Final prompt:', finalPrompt)

    setIsRunning(true)
    try {
      const genAI = new GoogleGenerativeAI(apiKey)
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
      const result = await model.generateContent(finalPrompt)
      const reply = result.response.text()
      const responseId = `response-${Date.now()}`

      setNodes((prevNodes) => [
        ...prevNodes,
        {
          id: responseId,
          type: 'custom',
          position: { x: xPos ?? 0, y: (yPos ?? 0) + 200 },
          data: { label: reply },
        },
      ])

      setEdges((prevEdges) => [
        ...prevEdges,
        { id: `e-${id}-${responseId}`, source: id, target: responseId },
      ])
    } catch (error) {
      console.error('Gemini run failed:', error)
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div style={{
      padding: 12,
      borderRadius: 12,
      background: '#fff',
      color: '#000',
      border: '2px solid #000',
      fontSize: 14,
      fontFamily: 'monospace',
      minWidth: 200,
    }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>
        {data.label || 'Input'}
      </div>
      <textarea
        className="nodrag nowheel"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="输入 prompt..."
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
        onClick={runPrompt}
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
        {isRunning ? '运行中...' : '运行'}
      </button>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

export default InputNode
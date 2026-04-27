import { useRef, useState } from 'react'
import { Handle, Position, useReactFlow } from 'reactflow'
import type { NodeProps } from 'reactflow'

function ImageInputNode({ id, data }: NodeProps) {
  const [imageBase64, setImageBase64] = useState<string>(
    typeof data?.content === 'string' ? data.content : '',
  )
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { setNodes } = useReactFlow()

  const handlePickImage = () => {
    inputRef.current?.click()
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      if (!result) return

      setImageBase64(result)
      setNodes((prevNodes) =>
        prevNodes.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  content: result,
                },
              }
            : node,
        ),
      )
    }
    reader.readAsDataURL(file)
    event.target.value = ''
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
        minWidth: 220,
      }}
    >
      <div style={{ marginBottom: 8, fontSize: 12, color: '#666' }}>图片输入</div>

      <input
        ref={inputRef}
        className="nodrag"
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      <button
        className="nodrag"
        onClick={handlePickImage}
        style={{
          marginBottom: 10,
          background: '#000',
          color: '#fff',
          border: '1px solid #000',
          borderRadius: 6,
          padding: '6px 12px',
          fontSize: 13,
          fontFamily: 'monospace',
          cursor: 'pointer',
        }}
      >
        上传图片
      </button>

      {imageBase64 ? (
        <div className="nodrag">
          <img
            src={imageBase64}
            alt="uploaded preview"
            style={{
              display: 'block',
              maxWidth: 200,
              maxHeight: 200,
              borderRadius: 6,
            }}
          />
        </div>
      ) : null}

      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

export default ImageInputNode

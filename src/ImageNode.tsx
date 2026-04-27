import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'

function ImageNode({ data }: NodeProps) {
  const label = typeof data?.label === 'string' ? data.label : '图片输出'
  const imageUrl = typeof data?.imageUrl === 'string' ? data.imageUrl : ''

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        background: '#000',
        color: '#fff',
        border: '2px solid #000',
        fontSize: 14,
        fontFamily: 'monospace',
        minWidth: 220,
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div style={{ marginBottom: 8, fontSize: 12, color: '#fff' }}>{label}</div>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt="generated"
          style={{
            display: 'block',
            maxWidth: 400,
            maxHeight: 400,
            borderRadius: 6,
          }}
        />
      ) : null}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

export default ImageNode

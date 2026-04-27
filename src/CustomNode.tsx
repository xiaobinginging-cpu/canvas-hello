import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'

function CustomNode({ data }: NodeProps) {
  return (
    <div style={{
      padding: '12px 20px',
      borderRadius: 12,
      background: '#000',
      color: '#fff',
      border: '2px solid #000',
      fontSize: 14,
      fontFamily: 'monospace',
      minWidth: 100,
      textAlign: 'center',
    }}>
      <Handle type="target" position={Position.Top} />
      <div>{data.label}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

export default CustomNode
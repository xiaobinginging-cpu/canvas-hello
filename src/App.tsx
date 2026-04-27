import { useCallback, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
} from 'reactflow'
import type { Connection, Edge, Node } from 'reactflow'
import 'reactflow/dist/style.css'
import CustomNode from './CustomNode'
import InputNode from './InputNode'
import ImageInputNode from './ImageInputNode'
import ImageNode from './ImageNode'
import ImageGenNode from './ImageGenNode'
import ImageToPromptNode from './ImageToPromptNode'

const nodeTypes = {
  custom: CustomNode,
  input: InputNode,
  imageInput: ImageInputNode,
  imageNode: ImageNode,
  imageGen: ImageGenNode,
  imageToPrompt: ImageToPromptNode,
}

const initialNodes: Node[] = [
  { id: '1', type: 'custom', position: { x: 100, y: 100 }, data: { label: 'Hello' } },
  { id: '2', type: 'custom', position: { x: 300, y: 100 }, data: { label: '小克' } },
  { id: '3', type: 'custom', position: { x: 500, y: 100 }, data: { label: '若斌' } },
]

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2' },
  { id: 'e2-3', source: '2', target: '3' },
]

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

// 启动时加载
useEffect(() => {
  const saved = localStorage.getItem('canvas-state')
  if (saved) {
    try {
      const { nodes: savedNodes, edges: savedEdges } = JSON.parse(saved)
      setNodes(savedNodes)
      setEdges(savedEdges)
    } catch (e) {
      console.error('Failed to load', e)
    }
  }
}, [])

// 每次变化自动保存
useEffect(() => {
  localStorage.setItem('canvas-state', JSON.stringify({ nodes, edges }))
}, [nodes, edges])

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  )

  const addNode = () => {
    const newNode: Node = {
      id: `${nodes.length + 1}`,
      type: 'custom',
      position: { x: Math.random() * 500 + 100, y: Math.random() * 300 + 100 },
      data: { label: `节点 ${nodes.length + 1}` },
    }
    setNodes((nds) => [...nds, newNode])
  }

  const addInputNode = () => {
    const newNode: Node = {
      id: `${nodes.length + 1}`,
      type: 'input',
      position: { x: Math.random() * 500 + 100, y: Math.random() * 300 + 100 },
      data: { label: '输入节点' },
    }
    setNodes((nds) => [...nds, newNode])
  }

  const addImageInputNode = () => {
    const newNode: Node = {
      id: `${nodes.length + 1}`,
      type: 'imageInput',
      position: { x: 100, y: 200 },
      data: { content: '' },
    }
    setNodes((nds) => [...nds, newNode])
  }

  const addImageGenNode = () => {
    const newNode: Node = {
      id: `${nodes.length + 1}`,
      type: 'imageGen',
      position: { x: 400, y: 220 },
      data: { label: '' },
    }
    setNodes((nds) => [...nds, newNode])
  }

  const addImageToPromptNode = () => {
    const newNode: Node = {
      id: `${nodes.length + 1}`,
      type: 'imageToPrompt',
      position: { x: 100, y: 200 },
      data: { label: '' },
    }
    setNodes((nds) => [...nds, newNode])
  }

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <button
        onClick={addNode}
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 1000,
          padding: '8px 16px',
          background: '#000',
          color: '#fff',
          border: '1px solid #000',
          borderRadius: 6,
          fontFamily: 'monospace',
          cursor: 'pointer',
        }}
      >
        + 添加节点
      </button>
      <button
        onClick={addInputNode}
        style={{
          position: 'absolute',
          top: 10,
          left: 140,
          zIndex: 1000,
          padding: '8px 16px',
          background: '#000',
          color: '#fff',
          border: '1px solid #000',
          borderRadius: 6,
          fontFamily: 'monospace',
          cursor: 'pointer',
        }}
      >
        + 输入节点
      </button>
      <button
        onClick={addImageInputNode}
        style={{
          position: 'absolute',
          top: 10,
          left: 270,
          zIndex: 1000,
          padding: '8px 16px',
          background: '#000',
          color: '#fff',
          border: '1px solid #000',
          borderRadius: 6,
          fontFamily: 'monospace',
          cursor: 'pointer',
        }}
      >
        + 图片输入节点
      </button>
      <button
        onClick={addImageGenNode}
        style={{
          position: 'absolute',
          top: 10,
          left: 430,
          zIndex: 1000,
          padding: '8px 16px',
          background: '#000',
          color: '#fff',
          border: '1px solid #000',
          borderRadius: 6,
          fontFamily: 'monospace',
          cursor: 'pointer',
        }}
      >
        + 生图节点
      </button>
      <button
        onClick={addImageToPromptNode}
        style={{
          position: 'absolute',
          top: 10,
          left: 550,
          zIndex: 1000,
          padding: '8px 16px',
          background: '#000',
          color: '#fff',
          border: '1px solid #000',
          borderRadius: 6,
          fontFamily: 'monospace',
          cursor: 'pointer',
        }}
      >
        + 反推节点
      </button>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}

export default App
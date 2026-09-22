/**
 * DSH Workflow Visual Designer
 * SVG-based drag-and-drop workflow editor
 */

// ============================================================================
// State
// ============================================================================

const state = {
  nodes: new Map(),
  edges: [],
  selectedNode: null,
  dragging: null,
  connecting: null,
  pan: { x: 0, y: 0 },
  zoom: 1,
  nextId: 1,
};

// ============================================================================
// Constants
// ============================================================================

const NODE_WIDTH = 140;
const NODE_HEIGHT = 60;
const NODE_COLORS = {
  script: '#8b5cf6',
  task: '#3b82f6',
  llm: '#10b981',
  approval: '#f59e0b',
  sub_workflow: '#ec4899',
};

const NODE_ICONS = {
  script: '⚙️',
  task: '🤖',
  llm: '🧠',
  approval: '✋',
  sub_workflow: '📦',
};

// ============================================================================
// Canvas Setup
// ============================================================================

const canvas = document.getElementById('dag-canvas');
const canvasGroup = document.getElementById('canvas-group');
const nodesLayer = document.getElementById('nodes-layer');
const edgesLayer = document.getElementById('edges-layer');
const connectionPreview = document.getElementById('connection-preview');

function updateTransform() {
  canvasGroup.setAttribute('transform', `translate(${state.pan.x},${state.pan.y}) scale(${state.zoom})`);
}

// ============================================================================
// Node Operations
// ============================================================================

function createNode(type, x, y) {
  const id = `step-${state.nextId++}`;
  const node = {
    id,
    type,
    x,
    y,
    label: type.charAt(0).toUpperCase() + type.slice(1),
    config: getDefaultConfig(type),
  };

  state.nodes.set(id, node);
  renderNode(node);
  selectNode(id);
  return node;
}

function getDefaultConfig(type) {
  switch (type) {
    case 'script':
      return { run: 'echo hello', env: {}, timeout: 300 };
    case 'task':
      return { inputs: {}, outputs: [], acceptance: [], role: 'execute' };
    case 'llm':
      return { prompt: '', role: 'summary' };
    case 'approval':
      return { question: 'Approve?', options: ['approved', 'rejected'] };
    case 'sub_workflow':
      return { ref: '' };
    default:
      return {};
  }
}

function renderNode(node) {
  const existing = document.getElementById(node.id);
  if (existing) existing.remove();

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.id = node.id;
  g.classList.add('node');
  g.setAttribute('transform', `translate(${node.x},${node.y})`);

  // Rectangle
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', NODE_WIDTH);
  rect.setAttribute('height', NODE_HEIGHT);
  rect.setAttribute('fill', NODE_COLORS[node.type]);
  rect.setAttribute('stroke', 'transparent');
  g.appendChild(rect);

  // Icon
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  icon.setAttribute('x', 12);
  icon.setAttribute('y', 35);
  icon.textContent = NODE_ICONS[node.type];
  g.appendChild(icon);

  // Label
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('x', 36);
  label.setAttribute('y', 35);
  label.textContent = truncate(node.label, 12);
  g.appendChild(label);

  // Type badge
  const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  badge.classList.add('type-badge');
  badge.setAttribute('x', NODE_WIDTH / 2);
  badge.setAttribute('y', NODE_HEIGHT - 8);
  badge.setAttribute('text-anchor', 'middle');
  badge.textContent = node.type;
  g.appendChild(badge);

  // Input port
  const inputPort = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  inputPort.classList.add('port', 'input');
  inputPort.setAttribute('cy', NODE_HEIGHT / 2);
  inputPort.setAttribute('r', 6);
  inputPort.dataset.nodeId = node.id;
  inputPort.dataset.portType = 'input';
  g.appendChild(inputPort);

  // Output port
  const outputPort = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  outputPort.classList.add('port', 'output');
  outputPort.setAttribute('cx', NODE_WIDTH);
  outputPort.setAttribute('cy', NODE_HEIGHT / 2);
  outputPort.setAttribute('r', 6);
  outputPort.dataset.nodeId = node.id;
  outputPort.dataset.portType = 'output';
  g.appendChild(outputPort);

  // Event listeners
  g.addEventListener('mousedown', (e) => onNodeMouseDown(e, node.id));
  outputPort.addEventListener('mousedown', (e) => onPortMouseDown(e, node.id, 'output'));
  inputPort.addEventListener('mouseup', (e) => onPortMouseUp(e, node.id, 'input'));

  nodesLayer.appendChild(g);
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len - 2) + '..' : str;
}

function selectNode(id) {
  // Deselect previous
  if (state.selectedNode) {
    const prev = document.getElementById(state.selectedNode);
    if (prev) prev.classList.remove('selected');
  }

  state.selectedNode = id;
  const node = document.getElementById(id);
  if (node) node.classList.add('selected');

  renderProperties(state.nodes.get(id));
}

function deleteNode(id) {
  const node = state.nodes.get(id);
  if (!node) return;

  // Remove edges
  state.edges = state.edges.filter(e => e.from !== id && e.to !== id);

  // Remove node
  state.nodes.delete(id);
  document.getElementById(id)?.remove();

  // Clear selection
  if (state.selectedNode === id) {
    state.selectedNode = null;
    renderProperties(null);
  }

  renderEdges();
}

// ============================================================================
// Edge Operations
// ============================================================================

function addEdge(fromId, toId) {
  // Check for duplicates
  if (state.edges.some(e => e.from === fromId && e.to === toId)) return;

  // Check for cycles
  if (wouldCreateCycle(fromId, toId)) return;

  state.edges.push({ from: fromId, to: toId });
  renderEdges();
}

function wouldCreateCycle(fromId, toId) {
  const visited = new Set();
  const stack = [toId];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === fromId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const edge of state.edges) {
      if (edge.from === current) {
        stack.push(edge.to);
      }
    }
  }

  return false;
}

function renderEdges() {
  edgesLayer.innerHTML = '';

  for (const edge of state.edges) {
    const fromNode = state.nodes.get(edge.from);
    const toNode = state.nodes.get(edge.to);
    if (!fromNode || !toNode) continue;

    const x1 = fromNode.x + NODE_WIDTH;
    const y1 = fromNode.y + NODE_HEIGHT / 2;
    const x2 = toNode.x;
    const y2 = toNode.y + NODE_HEIGHT / 2;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.classList.add('edge');
    path.setAttribute('d', bezierPath(x1, y1, x2, y2));
    path.dataset.from = edge.from;
    path.dataset.to = edge.to;

    path.addEventListener('click', () => {
      state.edges = state.edges.filter(e => !(e.from === edge.from && e.to === edge.to));
      renderEdges();
    });

    edgesLayer.appendChild(path);
  }
}

function bezierPath(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1) / 2;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

// ============================================================================
// Properties Panel
// ============================================================================

function renderProperties(node) {
  const container = document.getElementById('properties-content');
  if (!node) {
    container.innerHTML = '<div class="properties-empty"><p>Select a node to edit</p></div>';
    return;
  }

  let html = `
    <div class="form-group">
      <label class="form-label">ID</label>
      <input class="form-input" value="${node.id}" disabled>
    </div>
    <div class="form-group">
      <label class="form-label">Label</label>
      <input class="form-input" id="prop-label" value="${node.label}">
    </div>
    <div class="form-group">
      <label class="form-label">Type</label>
      <input class="form-input" value="${node.type}" disabled>
    </div>
    <div class="form-group">
      <label class="form-label">Dependencies</label>
      <div class="deps-list" id="prop-deps">
        ${getDepsForNode(node.id).map(dep => `
          <span class="dep-tag">
            ${dep}
            <button onclick="removeDep('${node.id}', '${dep}')">×</button>
          </span>
        `).join('')}
      </div>
    </div>
  `;

  // Type-specific fields
  html += renderTypeProperties(node);

  html += `
    <div style="margin-top: 20px;">
      <button class="btn btn-primary" onclick="saveNodeProperties('${node.id}')" style="width: 100%;">Save</button>
      <button class="btn btn-secondary" onclick="deleteNode('${node.id}')" style="width: 100%; margin-top: 8px;">Delete</button>
    </div>
  `;

  container.innerHTML = html;
}

function getDepsForNode(nodeId) {
  return state.edges
    .filter(e => e.to === nodeId)
    .map(e => e.from);
}

function renderTypeProperties(node) {
  const config = node.config;

  switch (node.type) {
    case 'script':
      return `
        <div class="form-group">
          <label class="form-label">Command</label>
          <textarea class="form-input" id="prop-run">${config.run || ''}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Timeout (s)</label>
          <input class="form-input" type="number" id="prop-timeout" value="${config.timeout || 300}">
        </div>
      `;

    case 'task':
      return `
        <div class="form-group">
          <label class="form-label">Outputs (one per line)</label>
          <textarea class="form-input" id="prop-outputs">${(config.outputs || []).join('\n')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Acceptance Criteria</label>
          <textarea class="form-input" id="prop-acceptance">${(config.acceptance || []).join('\n')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Role</label>
          <select class="form-input" id="prop-role">
            <option value="execute" ${config.role === 'execute' ? 'selected' : ''}>Execute</option>
            <option value="review" ${config.role === 'review' ? 'selected' : ''}>Review</option>
            <option value="research" ${config.role === 'research' ? 'selected' : ''}>Research</option>
            <option value="summary" ${config.role === 'summary' ? 'selected' : ''}>Summary</option>
          </select>
        </div>
      `;

    case 'llm':
      return `
        <div class="form-group">
          <label class="form-label">Prompt</label>
          <textarea class="form-input" id="prop-prompt">${config.prompt || ''}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Role</label>
          <select class="form-input" id="prop-role">
            <option value="summary" ${config.role === 'summary' ? 'selected' : ''}>Summary</option>
            <option value="review" ${config.role === 'review' ? 'selected' : ''}>Review</option>
            <option value="research" ${config.role === 'research' ? 'selected' : ''}>Research</option>
          </select>
        </div>
      `;

    case 'approval':
      return `
        <div class="form-group">
          <label class="form-label">Question</label>
          <input class="form-input" id="prop-question" value="${config.question || ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Options (one per line)</label>
          <textarea class="form-input" id="prop-options">${(config.options || []).join('\n')}</textarea>
        </div>
      `;

    case 'sub_workflow':
      return `
        <div class="form-group">
          <label class="form-label">Workflow Reference</label>
          <input class="form-input" id="prop-ref" value="${config.ref || ''}">
        </div>
      `;

    default:
      return '';
  }
}

function saveNodeProperties(nodeId) {
  const node = state.nodes.get(nodeId);
  if (!node) return;

  // Update label
  const labelInput = document.getElementById('prop-label');
  if (labelInput) node.label = labelInput.value;

  // Update type-specific config
  switch (node.type) {
    case 'script':
      node.config.run = document.getElementById('prop-run')?.value || '';
      node.config.timeout = parseInt(document.getElementById('prop-timeout')?.value || '300');
      break;
    case 'task':
      node.config.outputs = (document.getElementById('prop-outputs')?.value || '').split('\n').filter(Boolean);
      node.config.acceptance = (document.getElementById('prop-acceptance')?.value || '').split('\n').filter(Boolean);
      node.config.role = document.getElementById('prop-role')?.value || 'execute';
      break;
    case 'llm':
      node.config.prompt = document.getElementById('prop-prompt')?.value || '';
      node.config.role = document.getElementById('prop-role')?.value || 'summary';
      break;
    case 'approval':
      node.config.question = document.getElementById('prop-question')?.value || '';
      node.config.options = (document.getElementById('prop-options')?.value || '').split('\n').filter(Boolean);
      break;
    case 'sub_workflow':
      node.config.ref = document.getElementById('prop-ref')?.value || '';
      break;
  }

  renderNode(node);
  if (state.selectedNode === nodeId) {
    const el = document.getElementById(nodeId);
    if (el) el.classList.add('selected');
  }
}

function removeDep(nodeId, depId) {
  state.edges = state.edges.filter(e => !(e.from === depId && e.to === nodeId));
  renderEdges();
  renderProperties(state.nodes.get(nodeId));
}

// ============================================================================
// Drag & Drop
// ============================================================================

// Palette drag
document.querySelectorAll('.palette-item').forEach(item => {
  item.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('type', item.dataset.type);
  });
});

canvas.addEventListener('dragover', (e) => e.preventDefault());
canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  const type = e.dataTransfer.getData('type');
  if (!type) return;

  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left - state.pan.x) / state.zoom;
  const y = (e.clientY - rect.top - state.pan.y) / state.zoom;

  createNode(type, x, y);
});

// Node drag
function onNodeMouseDown(e, nodeId) {
  if (e.target.classList.contains('port')) return;

  e.stopPropagation();
  selectNode(nodeId);

  const node = state.nodes.get(nodeId);
  if (!node) return;

  state.dragging = {
    nodeId,
    startX: e.clientX,
    startY: e.clientY,
    nodeX: node.x,
    nodeY: node.y,
  };
}

// Port connection
function onPortMouseDown(e, nodeId, portType) {
  if (portType !== 'output') return;

  e.stopPropagation();
  state.connecting = {
    fromId: nodeId,
    startX: e.clientX,
    startY: e.clientY,
  };
}

function onPortMouseUp(e, nodeId, portType) {
  if (portType !== 'input' || !state.connecting) return;

  e.stopPropagation();
  addEdge(state.connecting.fromId, nodeId);
  state.connecting = null;
  connectionPreview.setAttribute('d', '');
}

// Mouse move
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left - state.pan.x) / state.zoom;
  const y = (e.clientY - rect.top - state.pan.y) / state.zoom;

  // Node dragging
  if (state.dragging) {
    const { nodeId, startX, startY, nodeX, nodeY } = state.dragging;
    const node = state.nodes.get(nodeId);
    if (node) {
      node.x = nodeX + (e.clientX - startX) / state.zoom;
      node.y = nodeY + (e.clientY - startY) / state.zoom;
      const el = document.getElementById(nodeId);
      if (el) el.setAttribute('transform', `translate(${node.x},${node.y})`);
      renderEdges();
    }
  }

  // Connection preview
  if (state.connecting) {
    const fromNode = state.nodes.get(state.connecting.fromId);
    if (fromNode) {
      const x1 = fromNode.x + NODE_WIDTH;
      const y1 = fromNode.y + NODE_HEIGHT / 2;
      connectionPreview.setAttribute('d', bezierPath(x1, y1, x, y));
    }
  }
});

// Mouse up
canvas.addEventListener('mouseup', () => {
  state.dragging = null;
  state.connecting = null;
  connectionPreview.setAttribute('d', '');
});

// Pan
let isPanning = false;
let panStart = { x: 0, y: 0 };

canvas.addEventListener('mousedown', (e) => {
  if (e.target === canvas || e.target.id === 'canvas-group') {
    isPanning = true;
    panStart = { x: e.clientX - state.pan.x, y: e.clientY - state.pan.y };
    canvas.style.cursor = 'grabbing';
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (isPanning) {
    state.pan.x = e.clientX - panStart.x;
    state.pan.y = e.clientY - panStart.y;
    updateTransform();
  }
});

canvas.addEventListener('mouseup', () => {
  isPanning = false;
  canvas.style.cursor = '';
});

// Zoom
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  state.zoom = Math.max(0.2, Math.min(3, state.zoom + delta));
  updateTransform();
});

// ============================================================================
// Toolbar Actions
// ============================================================================

document.getElementById('btn-zoom-in').addEventListener('click', () => {
  state.zoom = Math.min(3, state.zoom + 0.2);
  updateTransform();
});

document.getElementById('btn-zoom-out').addEventListener('click', () => {
  state.zoom = Math.max(0.2, state.zoom - 0.2);
  updateTransform();
});

document.getElementById('btn-zoom-fit').addEventListener('click', () => {
  if (state.nodes.size === 0) {
    state.pan = { x: 0, y: 0 };
    state.zoom = 1;
    updateTransform();
    return;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of state.nodes.values()) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + NODE_WIDTH);
    maxY = Math.max(maxY, node.y + NODE_HEIGHT);
  }

  const rect = canvas.getBoundingClientRect();
  const width = maxX - minX + 100;
  const height = maxY - minY + 100;

  state.zoom = Math.min(rect.width / width, rect.height / height, 1.5);
  state.pan.x = (rect.width - width * state.zoom) / 2 - minX * state.zoom + 50 * state.zoom;
  state.pan.y = (rect.height - height * state.zoom) / 2 - minY * state.zoom + 50 * state.zoom;
  updateTransform();
});

document.getElementById('btn-auto-layout').addEventListener('click', autoLayout);
document.getElementById('btn-export-yaml').addEventListener('click', exportYAML);
document.getElementById('btn-import-yaml').addEventListener('click', importYAML);
document.getElementById('btn-save').addEventListener('click', saveDesign);

// ============================================================================
// Auto Layout (Kahn's algorithm)
// ============================================================================

function autoLayout() {
  const nodes = Array.from(state.nodes.values());
  if (nodes.length === 0) return;

  // Build adjacency and in-degree
  const inDegree = new Map();
  const adj = new Map();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }

  for (const edge of state.edges) {
    adj.get(edge.from)?.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }

  // Topological sort (Kahn's)
  const layers = [];
  let queue = nodes.filter(n => (inDegree.get(n.id) || 0) === 0).map(n => n.id);

  while (queue.length > 0) {
    layers.push([...queue]);
    const next = [];
    for (const id of queue) {
      for (const dep of adj.get(id) || []) {
        const deg = (inDegree.get(dep) || 1) - 1;
        inDegree.set(dep, deg);
        if (deg === 0) next.push(dep);
      }
    }
    queue = next;
  }

  // Position nodes
  const layerGap = 120;
  const nodeGap = 40;

  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    const layer = layers[layerIdx];
    const totalWidth = layer.length * NODE_WIDTH + (layer.length - 1) * nodeGap;
    let startX = -totalWidth / 2;

    for (const nodeId of layer) {
      const node = state.nodes.get(nodeId);
      if (node) {
        node.x = startX;
        node.y = layerIdx * layerGap;
        startX += NODE_WIDTH + nodeGap;
      }
    }
  }

  // Render
  for (const node of nodes) {
    renderNode(node);
  }
  renderEdges();

  // Fit view
  document.getElementById('btn-zoom-fit').click();
}

// ============================================================================
// YAML Export/Import
// ============================================================================

function exportYAML() {
  const nodes = Array.from(state.nodes.values());
  const steps = nodes.map(node => {
    const step = {
      id: node.id,
      type: node.type,
    };

    // Add dependencies
    const deps = state.edges.filter(e => e.to === node.id).map(e => e.from);
    if (deps.length > 0) step.deps = deps;

    // Add type-specific config
    Object.assign(step, node.config);

    return step;
  });

  const yaml = `apiVersion: workflow-wise/v1
kind: Workflow
metadata:
  name: my-workflow
  title: My Workflow
spec:
  max_concurrency: 4
  steps:
${steps.map(s => `    - ${formatStepYAML(s)}`).join('\n')}
`;

  showExportModal(yaml);
}

function formatStepYAML(step) {
  let lines = [`id: ${step.id}`, `type: ${step.type}`];

  if (step.deps?.length) lines.push(`deps: [${step.deps.join(', ')}]`);
  if (step.run) lines.push(`run: "${step.run}"`);
  if (step.prompt) lines.push(`prompt: "${step.prompt}"`);
  if (step.question) lines.push(`question: "${step.question}"`);
  if (step.ref) lines.push(`ref: ${step.ref}`);
  if (step.role) lines.push(`role: ${step.role}`);
  if (step.timeout) lines.push(`timeout: ${step.timeout}`);
  if (step.options?.length) lines.push(`options: [${step.options.join(', ')}]`);
  if (step.outputs?.length) lines.push(`outputs: [${step.outputs.join(', ')}]`);
  if (step.acceptance?.length) {
    lines.push('acceptance:');
    step.acceptance.forEach(a => lines.push(`        - "${a}"`));
  }

  return lines.join(', ');
}

function importYAML() {
  showImportModal();
}

function loadYAML(yaml) {
  // Simple YAML parser for workflow definitions
  const steps = [];
  const lines = yaml.split('\n');
  let currentStep = null;
  let inSteps = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('- id:')) {
      if (currentStep) steps.push(currentStep);
      currentStep = { id: trimmed.replace('- id:', '').trim(), type: 'script' };
      inSteps = true;
    } else if (inSteps && currentStep) {
      if (trimmed.startsWith('type:')) {
        currentStep.type = trimmed.replace('type:', '').trim();
      } else if (trimmed.startsWith('deps:')) {
        const depsStr = trimmed.replace('deps:', '').trim();
        currentStep.deps = depsStr.replace(/[\[\]]/g, '').split(',').map(s => s.trim());
      } else if (trimmed.startsWith('run:')) {
        currentStep.run = trimmed.replace('run:', '').trim().replace(/^"|"$/g, '');
      } else if (trimmed.startsWith('prompt:')) {
        currentStep.prompt = trimmed.replace('prompt:', '').trim().replace(/^"|"$/g, '');
      } else if (trimmed.startsWith('question:')) {
        currentStep.question = trimmed.replace('question:', '').trim().replace(/^"|"$/g, '');
      } else if (trimmed.startsWith('ref:')) {
        currentStep.ref = trimmed.replace('ref:', '').trim();
      } else if (trimmed.startsWith('role:')) {
        currentStep.role = trimmed.replace('role:', '').trim();
      } else if (trimmed.startsWith('timeout:')) {
        currentStep.timeout = parseInt(trimmed.replace('timeout:', '').trim());
      }
    }
  }
  if (currentStep) steps.push(currentStep);

  // Clear and load
  state.nodes.clear();
  state.edges = [];
  nodesLayer.innerHTML = '';
  edgesLayer.innerHTML = '';

  // Create nodes
  const nodeMap = new Map();
  for (const step of steps) {
    const node = {
      id: step.id,
      type: step.type,
      x: 0,
      y: 0,
      label: step.id,
      config: { ...step },
    };
    state.nodes.set(step.id, node);
    nodeMap.set(step.id, node);
  }

  // Create edges
  for (const step of steps) {
    if (step.deps) {
      for (const dep of step.deps) {
        if (nodeMap.has(dep)) {
          state.edges.push({ from: dep, to: step.id });
        }
      }
    }
  }

  // Render
  for (const node of state.nodes.values()) {
    renderNode(node);
  }
  renderEdges();
  autoLayout();
}

// ============================================================================
// Modals
// ============================================================================

function showExportModal(yaml) {
  const modal = document.getElementById('modal-container');
  modal.innerHTML = `
    <div class="modal-overlay" onclick="closeModal()">
      <div class="modal" onclick="event.stopPropagation()" style="width: 600px;">
        <div class="modal-header">
          <h3>Export YAML</h3>
          <button class="btn btn-secondary" onclick="closeModal()">×</button>
        </div>
        <div class="modal-body">
          <textarea class="form-input" style="min-height: 300px; font-family: monospace;" readonly>${yaml}</textarea>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" onclick="copyYAML()">Copy to Clipboard</button>
          <button class="btn btn-secondary" onclick="downloadYAML()">Download</button>
        </div>
      </div>
    </div>
  `;
  window._exportedYAML = yaml;
}

function showImportModal() {
  const modal = document.getElementById('modal-container');
  modal.innerHTML = `
    <div class="modal-overlay" onclick="closeModal()">
      <div class="modal" onclick="event.stopPropagation()" style="width: 600px;">
        <div class="modal-header">
          <h3>Import YAML</h3>
          <button class="btn btn-secondary" onclick="closeModal()">×</button>
        </div>
        <div class="modal-body">
          <textarea class="form-input" id="import-yaml" style="min-height: 300px; font-family: monospace;" placeholder="Paste YAML here..."></textarea>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" onclick="doImportYAML()">Import</button>
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function closeModal() {
  document.getElementById('modal-container').innerHTML = '';
}

function copyYAML() {
  navigator.clipboard.writeText(window._exportedYAML);
  closeModal();
}

function downloadYAML() {
  const blob = new Blob([window._exportedYAML], { type: 'text/yaml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'workflow.yaml';
  a.click();
  URL.revokeObjectURL(url);
  closeModal();
}

function doImportYAML() {
  const yaml = document.getElementById('import-yaml').value;
  if (yaml) loadYAML(yaml);
  closeModal();
}

// ============================================================================
// Save Design
// ============================================================================

function saveDesign() {
  const data = {
    nodes: Array.from(state.nodes.values()),
    edges: state.edges,
  };
  localStorage.setItem('dsh-workflow-design', JSON.stringify(data));
  alert('Design saved!');
}

function loadDesign() {
  const saved = localStorage.getItem('dsh-workflow-design');
  if (!saved) return;

  try {
    const data = JSON.parse(saved);
    state.nodes.clear();
    state.edges = data.edges || [];

    for (const node of data.nodes) {
      state.nodes.set(node.id, node);
      renderNode(node);
    }

    renderEdges();
    autoLayout();
  } catch (e) {
    console.error('Failed to load design:', e);
  }
}

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

document.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selectedNode && !e.target.matches('input, textarea')) {
      deleteNode(state.selectedNode);
    }
  }

  if (e.key === 'Escape') {
    closeModal();
  }
});

// ============================================================================
// Init
// ============================================================================

loadDesign();
updateTransform();

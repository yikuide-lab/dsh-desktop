/**
 * DSH Workflow UI
 * Main application logic
 */

// ============================================================================
// State
// ============================================================================

const state = {
  currentView: 'overview',
  workflows: [],
  runs: [],
  stats: { workflows: 0, runs: { total: 0, running: 0, completed: 0, failed: 0 } },
};

// ============================================================================
// API Client
// ============================================================================

const api = {
  async get(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`API error: ${response.statusText}`);
    return response.json();
  },

  async post(url, data) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`API error: ${response.statusText}`);
    return response.json();
  },

  async delete(url) {
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) throw new Error(`API error: ${response.statusText}`);
    return response.json();
  },
};

// ============================================================================
// Views
// ============================================================================

const views = {
  overview: {
    title: 'Overview',
    render() {
      return `
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Workflows</div>
            <div class="stat-value">${state.stats.workflows}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Total Runs</div>
            <div class="stat-value">${state.stats.runs.total}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Running</div>
            <div class="stat-value" style="color: var(--warning)">${state.stats.runs.running}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Completed</div>
            <div class="stat-value" style="color: var(--success)">${state.stats.runs.completed}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Recent Runs</h3>
          </div>
          <div id="recent-runs">
            ${state.runs.length === 0
              ? '<p style="color: var(--text-muted)">No runs yet</p>'
              : state.runs.slice(0, 5).map(run => `
                <div class="workflow-item" onclick="showRun('${run.id}')">
                  <div class="workflow-name">${run.workflowName}</div>
                  <div class="workflow-meta">
                    <span class="badge badge-${getStatusBadge(run.status)}">${run.status}</span>
                    <span>${new Date(run.startedAt).toLocaleString()}</span>
                  </div>
                </div>
              `).join('')}
          </div>
        </div>
      `;
    },
  },

  workflows: {
    title: 'Workflows',
    render() {
      return `
        <div class="workflow-list">
          ${state.workflows.length === 0
            ? '<p style="color: var(--text-muted)">No workflows created yet</p>'
            : state.workflows.map(wf => `
              <div class="workflow-item">
                <div class="workflow-name">${wf.metadata.title || wf.metadata.name}</div>
                <div class="workflow-desc">${wf.metadata.description || 'No description'}</div>
                <div class="workflow-meta">
                  <span>${wf.spec.steps.length} steps</span>
                  <span>${wf.spec.max_concurrency || 4} concurrency</span>
                </div>
                <div style="margin-top: 12px; display: flex; gap: 8px;">
                  <button class="btn btn-primary" onclick="startRun('${wf.metadata.name}')">Start Run</button>
                  <button class="btn btn-secondary" onclick="editWorkflow('${wf.metadata.name}')">Edit</button>
                  <button class="btn btn-danger" onclick="deleteWorkflow('${wf.metadata.name}')">Delete</button>
                </div>
              </div>
            `).join('')}
        </div>
      `;
    },
  },

  runs: {
    title: 'Runs',
    render() {
      return `
        <div class="workflow-list">
          ${state.runs.length === 0
            ? '<p style="color: var(--text-muted)">No runs yet</p>'
            : state.runs.map(run => `
              <div class="workflow-item" onclick="showRun('${run.id}')">
                <div class="workflow-name">${run.workflowName}</div>
                <div class="workflow-meta">
                  <span class="badge badge-${getStatusBadge(run.status)}">${run.status}</span>
                  <span>${new Date(run.startedAt).toLocaleString()}</span>
                  ${run.completedAt ? `<span>Duration: ${formatDuration(run.startedAt, run.completedAt)}</span>` : ''}
                </div>
              </div>
            `).join('')}
        </div>
      `;
    },
  },

  designer: {
    title: 'Visual Designer',
    render() {
      return `
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Create Workflow</h3>
          </div>
          <div class="form-group">
            <label class="form-label">Workflow Name</label>
            <input type="text" class="form-input" id="wf-name" placeholder="my-workflow">
          </div>
          <div class="form-group">
            <label class="form-label">Description</label>
            <input type="text" class="form-input" id="wf-desc" placeholder="Optional description">
          </div>
          <div class="form-group">
            <label class="form-label">YAML Definition</label>
            <textarea class="form-input" id="wf-yaml" placeholder="apiVersion: wfwise.io/v1
kind: Workflow
metadata:
  name: my-workflow
  title: My Workflow
spec:
  max_concurrency: 4
  steps:
    - id: step1
      type: script
      run: echo hello
    - id: step2
      type: llm
      deps: [step1]
      prompt: Summarize the result"></textarea>
          </div>
          <button class="btn btn-primary" onclick="createWorkflow()">Create Workflow</button>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">DAG Preview</h3>
          </div>
          <div class="dag-container">
            <svg class="dag-canvas" id="dag-preview"></svg>
          </div>
        </div>
      `;
    },
  },

  settings: {
    title: 'Settings',
    render() {
      return `
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">General Settings</h3>
          </div>
          <div class="form-group">
            <label class="form-label">Max Concurrency</label>
            <input type="number" class="form-input" id="settings-concurrency" value="4" min="1" max="16">
          </div>
          <div class="form-group">
            <label class="form-label">Tick Interval (ms)</label>
            <input type="number" class="form-input" id="settings-tick" value="1000" min="100" max="10000">
          </div>
          <button class="btn btn-primary" onclick="saveSettings()">Save Settings</button>
        </div>
      `;
    },
  },
};

// ============================================================================
// Helpers
// ============================================================================

function getStatusBadge(status) {
  const map = {
    completed: 'success',
    running: 'warning',
    failed: 'error',
    aborted: 'error',
  };
  return map[status] || '';
}

function formatDuration(start, end) {
  const ms = new Date(end) - new Date(start);
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

// ============================================================================
// Navigation
// ============================================================================

function navigateTo(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  document.getElementById('view-title').textContent = views[view].title;
  document.getElementById('content').innerHTML = views[view].render();
}

// ============================================================================
// Actions
// ============================================================================

async function createWorkflow() {
  const name = document.getElementById('wf-name').value;
  const yaml = document.getElementById('wf-yaml').value;

  if (!name || !yaml) {
    alert('Please fill in all fields');
    return;
  }

  try {
    await api.post('/api/workflows', { name, yaml });
    await loadWorkflows();
    navigateTo('workflows');
  } catch (error) {
    alert(`Failed to create workflow: ${error.message}`);
  }
}

async function startRun(workflowName) {
  try {
    await api.post(`/api/runs`, { workflowName });
    await loadRuns();
    navigateTo('runs');
  } catch (error) {
    alert(`Failed to start run: ${error.message}`);
  }
}

async function deleteWorkflow(name) {
  if (!confirm(`Delete workflow "${name}"?`)) return;

  try {
    await api.delete(`/api/workflows/${name}`);
    await loadWorkflows();
    navigateTo('workflows');
  } catch (error) {
    alert(`Failed to delete workflow: ${error.message}`);
  }
}

async function showRun(runId) {
  try {
    const run = await api.get(`/api/runs/${runId}`);
    showRunModal(run);
  } catch (error) {
    alert(`Failed to load run: ${error.message}`);
  }
}

function showRunModal(run) {
  const modal = document.getElementById('modal-container');
  modal.innerHTML = `
    <div class="modal-overlay" onclick="closeModal()">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>${run.workflowName}</h3>
          <button class="btn btn-secondary" onclick="closeModal()">×</button>
        </div>
        <div class="modal-body">
          <p><strong>Status:</strong> <span class="badge badge-${getStatusBadge(run.status)}">${run.status}</span></p>
          <p><strong>Started:</strong> ${new Date(run.startedAt).toLocaleString()}</p>
          ${run.completedAt ? `<p><strong>Completed:</strong> ${new Date(run.completedAt).toLocaleString()}</p>` : ''}
          ${run.error ? `<p><strong>Error:</strong> ${run.error}</p>` : ''}

          <h4 style="margin-top: 16px;">Tasks</h4>
          <div class="workflow-list">
            ${Object.entries(run.tasks).map(([stepId, task]) => `
              <div class="workflow-item">
                <div class="workflow-name">${stepId}</div>
                <div class="workflow-meta">
                  <span class="badge badge-${getStatusBadge(task.status)}">${task.status}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="modal-footer">
          ${run.status === 'running' ? `<button class="btn btn-danger" onclick="stopRun('${run.id}')">Stop</button>` : ''}
          <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
      </div>
    </div>
  `;
}

function closeModal() {
  document.getElementById('modal-container').innerHTML = '';
}

async function stopRun(runId) {
  try {
    await api.post(`/api/runs/${runId}/stop`);
    closeModal();
    await loadRuns();
    navigateTo('runs');
  } catch (error) {
    alert(`Failed to stop run: ${error.message}`);
  }
}

// ============================================================================
// Data Loading
// ============================================================================

async function loadWorkflows() {
  try {
    state.workflows = await api.get('/api/workflows');
  } catch (error) {
    console.error('Failed to load workflows:', error);
  }
}

async function loadRuns() {
  try {
    state.runs = await api.get('/api/runs');
  } catch (error) {
    console.error('Failed to load runs:', error);
  }
}

async function loadStats() {
  try {
    state.stats = await api.get('/api/stats');
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

// ============================================================================
// Initialization
// ============================================================================

async function init() {
  // Set up navigation
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => navigateTo(el.dataset.view));
  });

  // Load data
  await Promise.all([loadWorkflows(), loadRuns(), loadStats()]);

  // Render initial view
  navigateTo('overview');
}

// Start the app
init();

# ImageCanvas Development Guide

## Getting Started

### Prerequisites
- Node.js 14+ and npm
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Git for version control

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd ImageCanvas
```

2. Install dependencies:
```bash
# Install server dependencies
cd server
npm install

# Return to root
cd ..
```

3. Set up the database:
```bash
# Database is auto-created on first run
# Location: server/database/canvas.db
```

4. Configure environment:
```bash
# Copy example config (if available)
cp .env.example .env

# Or create manually with:
# PORT=3001
# NODE_ENV=development
```

### Running the Application

#### Development Mode
```bash
# From project root
cd server
npm run dev

# Server runs on http://localhost:3001
# Frontend served from http://localhost:3001
```

#### Production Mode
```bash
cd server
npm start
```

## Project Structure

```
ImageCanvas/
├── index.html              # Main HTML entry point
├── css/                    # Stylesheets
│   ├── styles.css         # Main styles
│   └── components/        # Component-specific styles
├── js/                     # Frontend JavaScript
│   ├── app.js             # Application entry point
│   ├── canvas.js          # Core canvas functionality
│   ├── core/              # New architecture components
│   ├── nodes/             # Node type implementations
│   ├── ui/                # UI components
│   ├── utils/             # Utility functions
│   └── actions/           # Canvas actions
├── server/                 # Backend application
│   ├── src/
│   │   ├── server.js      # Express server
│   │   ├── database/      # Database layer
│   │   └── realtime/      # WebSocket handlers
│   ├── uploads/           # User uploaded files
│   ├── thumbnails/        # Generated thumbnails
│   └── database/          # SQLite database files
├── docs/                   # Documentation
└── tests/                  # Test files
```

## Core Development Concepts

### 1. Node System

Creating a new node type:

```javascript
// js/nodes/custom-node.js
class CustomNode extends BaseNode {
  constructor(data) {
    super(data);
    this.type = 'custom';
    // Initialize custom properties
  }

  render(ctx, viewport) {
    // Save context state
    ctx.save();
    
    // Apply transformations
    this.applyTransform(ctx);
    
    // Custom rendering logic
    ctx.fillStyle = this.color;
    ctx.fillRect(0, 0, this.width, this.height);
    
    // Restore context
    ctx.restore();
  }

  serialize() {
    return {
      ...super.serialize(),
      // Add custom properties
      customProp: this.customProp
    };
  }

  static deserialize(data) {
    return new CustomNode(data);
  }
}

// Register the node type
nodeRegistry.register('custom', CustomNode);
```

### 2. Operations

Implementing a new operation:

```javascript
// js/operations/custom-operation.js
class CustomOperation {
  constructor(nodeId, data) {
    this.type = 'custom';
    this.nodeId = nodeId;
    this.data = data;
    this.timestamp = Date.now();
  }

  execute(canvas) {
    const node = canvas.getNode(this.nodeId);
    if (node) {
      // Store previous state for undo
      this.prevData = {
        customProp: node.customProp
      };
      
      // Apply changes
      node.customProp = this.data.customProp;
      canvas.markDirty();
    }
  }

  undo(canvas) {
    const node = canvas.getNode(this.nodeId);
    if (node && this.prevData) {
      node.customProp = this.prevData.customProp;
      canvas.markDirty();
    }
  }

  serialize() {
    return {
      type: this.type,
      nodeId: this.nodeId,
      data: this.data,
      timestamp: this.timestamp
    };
  }
}

// Register with operation pipeline
operationPipeline.registerOperation('custom', CustomOperation);
```

### 3. UI Components

Adding UI controls:

```javascript
// js/ui/custom-control.js
class CustomControl {
  constructor(container) {
    this.container = container;
    this.init();
  }

  init() {
    this.element = document.createElement('div');
    this.element.className = 'custom-control';
    this.element.innerHTML = `
      <button id="custom-action">Custom Action</button>
    `;
    
    this.container.appendChild(this.element);
    this.attachEvents();
  }

  attachEvents() {
    this.element.querySelector('#custom-action')
      .addEventListener('click', () => {
        this.handleAction();
      });
  }

  handleAction() {
    // Get selected nodes
    const selection = canvas.selection.getNodes();
    
    // Create and execute operation
    const operation = new CustomOperation(
      selection[0].id,
      { customProp: 'new-value' }
    );
    
    operationPipeline.execute(operation);
  }
}
```

## Testing

### Running Tests
```bash
# Run test suite
npm test

# Run specific test
node tests/test-state-sync.js
```

### Writing Tests
```javascript
// tests/test-custom-feature.js
const assert = require('assert');

describe('Custom Feature', () => {
  let canvas;
  
  beforeEach(() => {
    canvas = new Canvas();
  });

  it('should handle custom operation', () => {
    const node = new CustomNode({ x: 0, y: 0 });
    canvas.addNode(node);
    
    const operation = new CustomOperation(node.id, {
      customProp: 'test-value'
    });
    
    operation.execute(canvas);
    assert.equal(node.customProp, 'test-value');
    
    operation.undo(canvas);
    assert.equal(node.customProp, undefined);
  });
});
```

## Debugging

### Client-Side Debugging

1. Enable debug mode:
```javascript
// In browser console
localStorage.setItem('debug', 'imagecanvas:*');
```

2. View network operations:
```javascript
// Monitor WebSocket traffic
window.networkLayer.on('operation', (op) => {
  console.log('Operation:', op);
});
```

3. Inspect canvas state:
```javascript
// Get current canvas state
const state = canvas.exportState();
console.log('Canvas state:', state);

// Get selected nodes
const selection = canvas.selection.getNodes();
console.log('Selected:', selection);
```

### Server-Side Debugging

1. Enable verbose logging:
```bash
DEBUG=imagecanvas:* npm run dev
```

2. Monitor WebSocket events:
```javascript
// In server code
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.onAny((event, ...args) => {
    console.log(`Event: ${event}`, args);
  });
});
```

## Performance Optimization

### Client-Side

1. **Batch Operations**:
```javascript
// Batch multiple operations
operationPipeline.batch(() => {
  nodes.forEach(node => {
    operationPipeline.execute(new MoveOperation(node.id, x, y));
  });
});
```

2. **Throttle Expensive Operations**:
```javascript
// Throttle cursor updates
const throttledCursorUpdate = throttle((x, y) => {
  networkLayer.emit('cursor-move', { x, y });
}, 50);
```

3. **Use RequestAnimationFrame**:
```javascript
// Optimize rendering
let renderRequested = false;

function requestRender() {
  if (!renderRequested) {
    renderRequested = true;
    requestAnimationFrame(() => {
      canvas.render();
      renderRequested = false;
    });
  }
}
```

### Server-Side

1. **Operation Compression**:
```javascript
// Enable compression for large operations
io.use((socket, next) => {
  socket.compress(true);
  next();
});
```

2. **Database Optimization**:
```javascript
// Use transactions for bulk operations
db.transaction(() => {
  operations.forEach(op => {
    db.prepare('INSERT INTO operations...').run(op);
  });
})();
```

## Deployment

### Production Build
```bash
# Minify and optimize assets
npm run build

# Set production environment
export NODE_ENV=production
```

### Environment Variables
```bash
# Required for production
PORT=3001
NODE_ENV=production
DATABASE_PATH=/path/to/database
UPLOAD_PATH=/path/to/uploads
MAX_FILE_SIZE=10485760  # 10MB
```

### Security Checklist
- [ ] Enable HTTPS
- [ ] Set secure headers
- [ ] Configure CORS properly
- [ ] Validate all inputs
- [ ] Sanitize user content
- [ ] Set upload limits
- [ ] Enable rate limiting
- [ ] Use environment variables for secrets

## Common Issues

### WebSocket Connection Failed
```javascript
// Check CORS settings
const corsOptions = {
  origin: process.env.CLIENT_URL || 'http://localhost:3001',
  credentials: true
};
```

### State Sync Issues
```javascript
// Force full state sync
socket.emit('state-sync-request', {
  canvasId: currentCanvasId,
  force: true
});
```

### Memory Leaks
```javascript
// Ensure proper cleanup
window.addEventListener('beforeunload', () => {
  collaborativeArchitecture.shutdown();
});
```

## Contributing

### Code Style
- Use ES6+ features
- Follow existing patterns
- Comment complex logic
- Keep functions focused
- Use meaningful variable names

### Pull Request Process
1. Create feature branch
2. Make changes
3. Add tests
4. Update documentation
5. Submit PR with description

### Commit Messages
Follow conventional commits:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `style:` Code style
- `refactor:` Refactoring
- `test:` Tests
- `chore:` Maintenance
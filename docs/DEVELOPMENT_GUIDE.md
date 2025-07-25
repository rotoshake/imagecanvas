# ImageCanvas Development Guide

## Getting Started

### Prerequisites
- Node.js 16+ and npm
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Git for version control
- Python 3 (for local development server)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd ImageCanvas
```

2. Install dependencies:
```bash
# Install server dependencies
npm install
```

3. Database setup:
```bash
# SQLite database is auto-created on first run
# Location: server/database/canvas.db
```

### Running the Application

#### Development Mode

1. Start the backend server:
```bash
npm run server:dev
# Server runs on http://localhost:3000
```

2. In a separate terminal, start the frontend:
```bash
npm run dev
# Frontend served from http://localhost:8000
```

#### Production Mode
```bash
npm start
# Serves both frontend and backend from http://localhost:3000
```

## Project Structure

```
ImageCanvas/
├── index.html              # Main HTML entry point
├── css/                    # Stylesheets
│   ├── styles.css         # Main styles
│   └── properties.css     # Property inspector styles
├── js/                    # Frontend JavaScript
│   ├── app.js            # LiteGraph application wrapper
│   ├── canvas.js         # Core canvas functionality
│   ├── config.js         # Configuration constants
│   ├── core/             # Collaborative architecture
│   │   ├── CollaborativeArchitecture.js
│   │   ├── NetworkLayer.js
│   │   ├── OperationPipeline.js
│   │   ├── StateSyncManager.js
│   │   ├── ClientUndoManager.js
│   │   ├── TransactionManager.js
│   │   ├── ImageUploadCoordinator.js
│   │   └── ImageProcessingProgressManager.js
│   ├── nodes/            # Node implementations
│   │   ├── base-node.js
│   │   ├── image-node.js
│   │   ├── video-node.js
│   │   └── text-node.js
│   ├── commands/         # Command pattern operations
│   │   ├── Command.js
│   │   └── NodeCommands.js
│   ├── ui/              # UI components
│   │   ├── unified-notifications.js
│   │   ├── canvas-navigator.js
│   │   └── floating-properties-inspector.js
│   ├── utils/           # Utilities
│   │   ├── cache.js     # Image and thumbnail caching
│   │   ├── hash.js      # Image hashing
│   │   └── node-factory.js
│   └── managers/        # Feature managers
│       └── ImageUploadManager.js
├── server/              # Backend application
│   ├── index.js        # Express server entry
│   ├── src/
│   │   ├── database/   # SQLite database layer
│   │   ├── realtime/   # WebSocket collaboration
│   │   └── undo/       # Server-side undo system
│   ├── uploads/        # User uploaded files
│   ├── thumbnails/     # Generated thumbnails
│   └── database/       # SQLite database files
├── docs/               # Documentation
└── tests/             # Test files
```

## Core Development Concepts

### 1. Node System

Creating a new node type:

```javascript
// js/nodes/custom-node.js
import { BaseNode } from './base-node.js';
import { NodeFactory } from '../utils/node-factory.js';

export class CustomNode extends BaseNode {
    constructor() {
        super();
        this.type = 'custom';
        this.title = 'Custom Node';
        this.size = [200, 100];
        
        // Add custom properties
        this.properties = {
            customValue: '',
            ...this.properties
        };
    }

    onExecute() {
        // Called each frame during execution
        // Process inputs and generate outputs
    }

    onDrawForeground(ctx) {
        // Custom rendering on top of base node
        ctx.fillStyle = '#fff';
        ctx.font = '14px Arial';
        ctx.fillText(this.properties.customValue, 10, 30);
    }

    onPropertyChanged(property, value) {
        super.onPropertyChanged(property, value);
        
        if (property === 'customValue') {
            // Handle custom property changes
            this.setDirtyCanvas(true);
        }
    }

    serialize() {
        const data = super.serialize();
        // Add custom serialization if needed
        return data;
    }

    configure(data) {
        super.configure(data);
        // Custom deserialization if needed
    }
}

// Register the node type
NodeFactory.registerNodeType('custom', CustomNode);
```

### 2. Commands (Operations)

Implementing a new command:

```javascript
// js/commands/CustomCommand.js
import { Command } from './Command.js';

export class CustomCommand extends Command {
    constructor(params) {
        super('custom_operation');
        this.params = params;
    }

    async execute(context) {
        const { graph } = context;
        const node = graph.getNodeById(this.params.nodeId);
        
        if (!node) {
            throw new Error('Node not found');
        }

        // Store previous state for undo
        this.previousValue = node.properties.customValue;
        
        // Apply the change
        node.properties.customValue = this.params.newValue;
        node.setDirtyCanvas(true);
        
        // Generate undo data
        this.undoData = {
            nodeId: this.params.nodeId,
            oldValue: this.previousValue,
            newValue: this.params.newValue
        };
        
        return { success: true, node };
    }

    async undo(context) {
        const { graph } = context;
        const node = graph.getNodeById(this.undoData.nodeId);
        
        if (node) {
            node.properties.customValue = this.undoData.oldValue;
            node.setDirtyCanvas(true);
        }
    }
}

// Register with command system
import { CommandRegistry } from '../core/CommandRegistry.js';
CommandRegistry.register('custom_operation', CustomCommand);
```

### 3. Server-Side Operation Handler

```javascript
// server/src/operations/custom-handler.js
class CustomOperationHandler {
    static async execute(state, operation, userId) {
        const { nodeId, newValue } = operation.params;
        
        // Validate operation
        const node = state.nodes.find(n => n.id === nodeId);
        if (!node) {
            throw new Error('Node not found');
        }
        
        // Store previous value for undo
        const previousValue = node.properties.customValue;
        
        // Apply operation to state
        node.properties.customValue = newValue;
        
        return {
            changes: {
                updated: [{
                    id: nodeId,
                    properties: { customValue: newValue }
                }]
            },
            undoData: {
                nodeId,
                previousValue,
                newValue
            }
        };
    }
}

module.exports = CustomOperationHandler;
```

## Image Handling

### Upload Flow
1. Images are uploaded via HTTP first (not through WebSocket)
2. Server generates thumbnails (64, 128, 256, 512, 1024, 2048px)
3. Node is created with serverUrl reference only
4. This prevents WebSocket timeouts with large files

```javascript
// Example: Handling image drops
const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));

// Upload first
const uploads = await Promise.all(
    imageFiles.map(file => 
        window.imageUploadManager.uploadImage(dataUrl, file.name, hash)
    )
);

// Then create nodes with server URLs
uploads.forEach(upload => {
    window.app.operationPipeline.execute('node_create', {
        type: 'media/image',
        properties: {
            serverUrl: upload.url,
            filename: upload.filename,
            hash: upload.hash
        }
    });
});
```

## Testing

### Running Tests
```bash
# Run all tests
npm test

# Run specific test file
node tests/integration/test-state-sync.js

# Run with debug output
DEBUG=imagecanvas:* npm test
```

### Writing Tests
```javascript
// tests/integration/test-custom-feature.js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

describe('Custom Feature', () => {
    let app, graph;
    
    beforeEach(() => {
        // Setup test environment
        app = createTestApp();
        graph = app.graph;
    });

    it('should execute custom command', async () => {
        // Create test node
        const node = new CustomNode();
        graph.add(node);
        
        // Execute command
        const result = await app.operationPipeline.execute('custom_operation', {
            nodeId: node.id,
            newValue: 'test'
        });
        
        assert.strictEqual(result.success, true);
        assert.strictEqual(node.properties.customValue, 'test');
    });
});
```

## Debugging

### Client-Side Debugging

1. Enable verbose logging:
```javascript
// In browser console
localStorage.setItem('DEBUG', 'imagecanvas:*');
```

2. Monitor state changes:
```javascript
// Watch state sync
window.app.stateSyncManager.on('stateUpdate', (data) => {
    console.log('State update:', data);
});

// Track operations
window.app.operationPipeline.on('execute', (op) => {
    console.log('Operation:', op);
});
```

3. Inspect current state:
```javascript
// Get canvas state
const nodes = window.app.graph.serialize().nodes;
console.log('Nodes:', nodes);

// Check connection status
console.log('Connected:', window.app.networkLayer.connected);
```

### Server-Side Debugging

1. Enable debug logging:
```bash
DEBUG=imagecanvas:* npm run server:dev
```

2. Monitor WebSocket events:
```javascript
// Add to collaboration.js
socket.onAny((event, ...args) => {
    console.log(`[${socket.id}] ${event}:`, args);
});
```

3. Database inspection:
```bash
# Open SQLite CLI
sqlite3 server/database/canvas.db

# Common queries
.tables
SELECT * FROM projects;
SELECT COUNT(*) FROM operations WHERE project_id = 1;
SELECT * FROM users;
```

## Performance Guidelines

### Client-Side Optimization

1. **Image Loading**:
   - Always upload images before creating nodes
   - Use progressive thumbnails for rendering
   - Cache images by hash to avoid duplicates

2. **Rendering**:
   - Implement dirty rectangle tracking
   - Use LOD (Level of Detail) based on zoom
   - Batch render updates with requestAnimationFrame

3. **Operations**:
   - Keep operations under 100KB
   - Use transactions for bulk operations
   - Implement operation queuing

### Server-Side Optimization

1. **Database**:
   - Use WAL mode for concurrent access
   - Run periodic cleanup to remove old operations
   - Never store base64 data in operations table

2. **WebSocket**:
   - Set appropriate timeouts (5 min for large ops)
   - Compress messages over 1KB
   - Reject operations over 100KB

3. **File Handling**:
   - Generate thumbnails asynchronously
   - Use WebP format for smaller file sizes
   - Implement file deduplication by hash

## Common Issues & Solutions

### WebSocket Timeout on Image Drop
**Problem**: Server times out when dropping many large images
**Solution**: Images are now uploaded via HTTP first, then nodes are created

### Images Not Loading After Refresh
**Problem**: Thumbnails regenerating on every page load
**Solution**: Server thumbnails are now properly loaded using server filename

### Database Growing Too Large
**Problem**: Operations table storing base64 image data
**Solution**: Use the cleanup endpoint: `POST /database/cleanup`

### Undo Not Working Across Tabs
**Problem**: Undo state not synchronized
**Solution**: Server now broadcasts undo state updates to all user sessions

## Deployment Checklist

### Production Configuration
- [ ] Set NODE_ENV=production
- [ ] Configure proper CORS origins
- [ ] Enable HTTPS with valid certificates
- [ ] Set up proper logging (Winston/Morgan)
- [ ] Configure rate limiting
- [ ] Set appropriate file upload limits
- [ ] Enable gzip compression
- [ ] Set up database backups

### Security
- [ ] Validate all file uploads
- [ ] Sanitize user input (especially text nodes)
- [ ] Implement proper authentication
- [ ] Add CSRF protection
- [ ] Set secure HTTP headers
- [ ] Limit operation sizes
- [ ] Implement user quotas

### Monitoring
- [ ] Set up error tracking (Sentry)
- [ ] Monitor server performance
- [ ] Track WebSocket connections
- [ ] Monitor database size
- [ ] Set up uptime monitoring
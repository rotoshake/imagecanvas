# Proper Collaborative Architecture for ImageCanvas

## Design Principles

1. **Single Source of Truth**: One pipeline for all operations
2. **Command Pattern**: Operations are first-class objects
3. **Clear Separation**: Local execution vs network communication
4. **No Circular Dependencies**: Strict layering
5. **Transactional**: Operations either fully succeed or fully fail

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    User Interface Layer                      │
│  (canvas.js, alignment.js, UI components)                   │
└─────────────────────────┬───────────────────────────────────┘
                          │ Commands
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Command Layer                             │
│  (Validates, creates command objects)                       │
└─────────────────────────┬───────────────────────────────────┘
                          │ Commands
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                 Operation Pipeline                           │
│  (Single entry point for ALL operations)                    │
│  - Validation                                               │
│  - Authorization                                            │
│  - Execution                                                │
│  - Broadcasting (if local)                                  │
│  - History tracking                                         │
└─────────────────────────┬───────────────────────────────────┘
                          │ State Changes
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Graph Layer                               │
│  (Nodes, edges - pure data, no UI knowledge)               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Network Layer                               │
│  (Handles WebSocket communication only)                      │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Command Objects

Every operation is a command with:
- Unique ID
- Type
- Parameters
- Timestamp
- Origin (local/remote)
- Validation rules
- Execute method
- Undo method

```javascript
class Command {
    constructor(type, params, origin = 'local') {
        this.id = generateUUID();
        this.type = type;
        this.params = params;
        this.origin = origin;
        this.timestamp = Date.now();
        this.executed = false;
    }
    
    validate() {
        // Override in subclasses
        return { valid: true };
    }
    
    execute(context) {
        // Override in subclasses
        throw new Error('Execute not implemented');
    }
    
    undo(context) {
        // Override in subclasses
        throw new Error('Undo not implemented');
    }
}
```

### 2. Operation Pipeline

Single entry point for ALL operations:

```javascript
class OperationPipeline {
    constructor(app) {
        this.app = app;
        this.commandRegistry = new Map();
        this.executionQueue = [];
        this.executing = false;
        this.history = [];
        this.historyIndex = -1;
    }
    
    async execute(command) {
        // 1. Validate
        const validation = command.validate();
        if (!validation.valid) {
            throw new ValidationError(validation.error);
        }
        
        // 2. Queue for execution
        return new Promise((resolve, reject) => {
            this.executionQueue.push({ command, resolve, reject });
            this.processQueue();
        });
    }
    
    async processQueue() {
        if (this.executing || this.executionQueue.length === 0) return;
        
        this.executing = true;
        const { command, resolve, reject } = this.executionQueue.shift();
        
        try {
            // 3. Execute command
            const result = await command.execute({
                app: this.app,
                graph: this.app.graph,
                canvas: this.app.graphCanvas
            });
            
            // 4. Track in history (only for local commands)
            if (command.origin === 'local') {
                this.addToHistory(command);
            }
            
            // 5. Broadcast (only for local commands)
            if (command.origin === 'local' && this.app.networkLayer?.isConnected) {
                this.app.networkLayer.broadcast(command);
            }
            
            // 6. Update UI
            this.app.graphCanvas.dirty_canvas = true;
            
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.executing = false;
            this.processQueue(); // Process next command
        }
    }
}
```

### 3. Network Layer

Handles ONLY network communication:

```javascript
class NetworkLayer {
    constructor(app) {
        this.app = app;
        this.socket = null;
        this.isConnected = false;
    }
    
    broadcast(command) {
        if (!this.isConnected) return;
        
        this.socket.emit('operation', {
            command: {
                id: command.id,
                type: command.type,
                params: command.params,
                timestamp: command.timestamp
            }
        });
    }
    
    handleIncomingOperation(data) {
        // Create command from remote data
        const CommandClass = this.app.commandRegistry.get(data.command.type);
        if (!CommandClass) {
            console.warn('Unknown command type:', data.command.type);
            return;
        }
        
        const command = new CommandClass(data.command.params, 'remote');
        command.id = data.command.id; // Preserve original ID
        command.timestamp = data.command.timestamp;
        
        // Execute through same pipeline
        this.app.operationPipeline.execute(command).catch(error => {
            console.error('Failed to apply remote operation:', error);
        });
    }
}
```

### 4. Example Command Implementation

```javascript
class MoveNodeCommand extends Command {
    constructor(params, origin = 'local') {
        super('node_move', params, origin);
    }
    
    validate() {
        if (!this.params.nodeId) {
            return { valid: false, error: 'Missing nodeId' };
        }
        if (!Array.isArray(this.params.position) || this.params.position.length !== 2) {
            return { valid: false, error: 'Invalid position' };
        }
        return { valid: true };
    }
    
    execute(context) {
        const node = context.graph.getNodeById(this.params.nodeId);
        if (!node) {
            throw new Error('Node not found');
        }
        
        // Store old position for undo
        this.oldPosition = [...node.pos];
        
        // Update position
        node.pos[0] = this.params.position[0];
        node.pos[1] = this.params.position[1];
        
        return { node };
    }
    
    undo(context) {
        const node = context.graph.getNodeById(this.params.nodeId);
        if (!node) {
            throw new Error('Node not found');
        }
        
        node.pos[0] = this.oldPosition[0];
        node.pos[1] = this.oldPosition[1];
        
        return { node };
    }
}
```

## Migration Strategy

### Phase 1: Build New Infrastructure (Side-by-side)
1. Create Command classes for all operations
2. Build OperationPipeline
3. Create NetworkLayer
4. Test with a few operations

### Phase 2: Gradual Migration
1. Route operations through new pipeline one at a time
2. Keep old system functional during migration
3. Add compatibility layer for smooth transition

### Phase 3: Remove Old System
1. Remove all direct broadcast methods
2. Remove ActionManager
3. Remove operation handling from CollaborativeManager
4. Clean up circular dependencies

### Phase 4: Optimization
1. Add operation batching
2. Implement conflict resolution
3. Add operation compression
4. Performance tuning

## Key Benefits

1. **Single Entry Point**: All operations go through the pipeline
2. **No Circular Dependencies**: Clear layer separation
3. **Testable**: Each command can be tested in isolation
4. **Maintainable**: New operations just need a new Command class
5. **Debuggable**: Clear operation flow, easy to trace
6. **Scalable**: Can add features like offline support, conflict resolution

## What This Fixes

1. **Node disappearing**: Atomic operations, proper state management
2. **Race conditions**: Sequential execution queue
3. **Inconsistent state**: Single source of truth
4. **Multiple systems**: One pipeline to rule them all
5. **Circular dependencies**: Clean architecture layers
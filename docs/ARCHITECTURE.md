# ImageCanvas Architecture Overview

## System Design

ImageCanvas follows a **server-authoritative** client-server architecture with real-time synchronization capabilities. The system is designed for collaborative editing with multiple users working on the same canvas simultaneously.

### Server-Authoritative Model
The server maintains the canonical state of all canvases and is the single source of truth for:
- All canvas operations and their ordering
- Node positions, properties, and relationships  
- User permissions and access control
- Conflict resolution when concurrent operations occur
- State validation before broadcasting to clients

This approach ensures data consistency across all connected clients and prevents desynchronization issues common in peer-to-peer architectures.

## Core Components

### Frontend Architecture

#### 1. CollaborativeArchitecture (`js/core/CollaborativeArchitecture.js`)
The main orchestrator that coordinates all collaborative features:
- Initializes and manages all subsystems
- Handles system lifecycle (startup, shutdown)
- Coordinates between network, state, and canvas layers

#### 2. NetworkLayer (`js/core/NetworkLayer.js`)
Manages WebSocket connections and communication:
- Socket.IO integration for real-time updates
- Session management and reconnection logic
- Operation broadcasting and reception
- Connection state monitoring

#### 3. OperationPipeline (`js/core/OperationPipeline.js`)
Implements the command pattern for all canvas operations:
- Operation validation and execution
- Undo/redo functionality
- Operation batching for performance
- Command registration and dispatch

#### 4. StateSyncManager (`js/core/StateSyncManager.js`)
Synchronizes state across all connected clients:
- Incremental state updates
- Conflict resolution
- State reconciliation after reconnection
- Local state caching

#### 5. PersistenceHandler (`js/core/PersistenceHandler.js`)
Manages data persistence:
- Local storage for offline mode
- Server synchronization
- Auto-save functionality
- State recovery

### Backend Architecture

#### 1. Express Server (`server/src/server.js`)
REST API endpoints:
- `/api/auth/*` - Authentication
- `/api/projects/*` - Project management
- `/api/upload` - File uploads
- Static file serving

#### 2. WebSocket Layer (`server/src/realtime/collaboration.js`)
Real-time communication:
- Socket.IO server implementation
- Room-based collaboration
- Operation broadcasting
- Presence management

#### 3. CanvasStateManager (`server/src/realtime/CanvasStateManager.js`)
Server-side state authority:
- Maintains canonical state
- Operation validation
- State snapshots
- Client synchronization

#### 4. Database Layer (`server/src/database/database.js`)
SQLite with WAL mode:
- User management
- Project/canvas persistence
- Operation history
- Media metadata

## Data Flow

### Operation Flow (Server-Authoritative)
1. User performs action (e.g., move node)
2. Action creates Operation object
3. OperationPipeline applies operation **optimistically** on client
4. NetworkLayer sends operation to server for validation
5. **Server validates operation against canonical state**
6. **Server applies operation to authoritative state**
7. **Server broadcasts validated operation to all clients**
8. Remote clients apply server-validated operation
9. **If validation fails, server sends correction to originating client**

This flow ensures the server always maintains authoritative control while providing responsive UI through optimistic updates.

### State Synchronization (Server-Authoritative)
1. Client connects to canvas
2. **Server sends authoritative state snapshot from CanvasStateManager**
3. Incremental updates via server-validated operations
4. **Server enforces operation ordering and consistency**
5. **Server resolves conflicts using authoritative timestamps and state**
6. Clients request state reconciliation if they detect drift
7. **Server provides corrective state updates to maintain consistency**

The server's CanvasStateManager is the single source of truth, preventing the split-brain scenarios that can occur in distributed systems.

## Node System

### Base Node (`js/nodes/base-node.js`)
Abstract base class providing:
- Common properties (position, size, rotation)
- Event handling
- Serialization/deserialization
- Render lifecycle

### Node Types
- **ImageNode**: Raster image display
- **VideoNode**: Video playback with controls
- **TextNode**: WYSIWYG text editing

## Canvas Integration

### Canvas Manager (`js/canvas.js`)
Core canvas functionality:
- Rendering pipeline
- Hit testing
- Selection management
- Viewport controls

### Render Pipeline
1. Clear canvas
2. Apply viewport transform
3. Render nodes in z-order
4. Render selection overlays
5. Render UI elements

## Performance Optimizations

### Client-Side
- Operation batching (100ms window)
- Incremental rendering
- Image/thumbnail caching
- WebWorker for heavy operations
- RequestAnimationFrame scheduling

### Server-Side
- Connection pooling
- Operation compression
- Thumbnail generation queue
- SQLite WAL mode
- Static asset caching

## Security Considerations

### Current Implementation
- CORS configuration
- Helmet.js security headers
- File upload validation
- Rate limiting

### Required Improvements
- XSS protection for text nodes
- CSRF tokens
- Input sanitization
- Permission system

## Module Dependencies

```
CollaborativeArchitecture
├── NetworkLayer
├── OperationPipeline
├── StateSyncManager
├── PersistenceHandler
├── CleanupManager
└── CanvasIntegration
    └── Canvas.js
        ├── Nodes
        ├── Selection
        ├── Viewport
        └── Renderer
```

## Configuration

### Client Configuration (`js/utils/config.js`)
- Canvas dimensions
- Rendering quality
- Network timeouts
- Cache sizes

### Server Configuration
- Port settings
- CORS origins
- Upload limits
- Database paths
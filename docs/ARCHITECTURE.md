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
- Undo/redo operation history

This approach ensures data consistency across all connected clients and prevents desynchronization issues common in peer-to-peer architectures.

## Core Components

### Frontend Architecture

#### 1. CollaborativeArchitecture (`js/core/CollaborativeArchitecture.js`)
The main orchestrator that coordinates all collaborative features:
- Initializes and manages all subsystems
- Handles system lifecycle (startup, shutdown)
- Coordinates between network, state, and canvas layers
- Manages unified progress tracking for operations

#### 2. NetworkLayer (`js/core/NetworkLayer.js`)
Manages WebSocket connections and communication:
- Socket.IO integration for real-time updates
- Session management and reconnection logic
- Operation broadcasting and reception
- Connection state monitoring
- Automatic reconnection with exponential backoff

#### 3. OperationPipeline (`js/core/OperationPipeline.js`)
Implements the command pattern for all canvas operations:
- Operation validation and execution
- Command registration and dispatch
- Queue management for sequential execution
- Integration with undo/redo system

#### 4. StateSyncManager (`js/core/StateSyncManager.js`)
Synchronizes state across all connected clients:
- Optimistic updates for responsive UI
- Server reconciliation
- Operation tracking and correlation
- Conflict resolution
- Timeout handling for large operations

#### 5. ClientUndoManager (`js/core/ClientUndoManager.js`)
Client-side undo/redo coordination:
- Tracks local undo/redo state
- Communicates with server for undo operations
- Handles undo state synchronization across tabs
- Manages transaction grouping

#### 6. TransactionManager (`js/core/TransactionManager.js`)
Groups related operations:
- Transaction creation and management
- Atomic operation groups
- Support for bulk operations
- Integration with undo system

#### 7. Image Management System
- **ImageResourceCache** (`js/utils/cache.js`): Centralized image caching
- **ThumbnailCache** (`js/utils/cache.js`): Progressive thumbnail generation
- **ImageUploadManager** (`js/managers/ImageUploadManager.js`): HTTP-based uploads
- **ImageUploadCoordinator** (`js/core/ImageUploadCoordinator.js`): Background upload coordination
- **ImageProcessingProgressManager** (`js/core/ImageProcessingProgressManager.js`): Unified progress tracking
- **ThumbnailRequestCoordinator** (`js/core/ThumbnailRequestCoordinator.js`): Batched thumbnail requests
- **WebGLRenderer** (`js/renderers/WebGLRenderer.js`): Hardware-accelerated rendering
- **TextureLODManager** (`js/renderers/TextureLODManager.js`): GPU texture management

#### 8. UI Components
- **FloatingColorCorrection** (`js/ui/floating-color-correction.js`): Color adjustment interface
- **SplineCurveEditor** (`js/ui/components/spline-curve-editor.js`): Tone curve editing
- **ColorBalanceWheel** (`js/ui/components/color-balance-wheel.js`): Color grading controls
- **AdminPanel** (`js/ui/admin-panel.js`): System administration interface
- **KeyboardShortcutManager** (`js/config/keyboard-shortcuts-integration.js`): Shortcut handling

### Backend Architecture

#### 1. Express Server (`server/index.js`)
REST API endpoints:
- `/api/upload` - HTTP file uploads (images/videos)
- `/api/thumbnails/batch` - Batch thumbnail URL generation
- `/projects/*` - Project management
- `/database/cleanup` - Database maintenance
- `/database/size` - Database size information
- `/uploads/*` - Static file serving
- `/thumbnails/*` - Thumbnail serving

#### 2. CollaborationManager (`server/src/realtime/collaboration.js`)
Real-time communication:
- Socket.IO server implementation
- Multi-tab support per user
- Room-based collaboration
- Operation validation and size limits (100KB max)
- Transaction support

#### 3. CanvasStateManager (`server/src/realtime/CanvasStateManager.js`)
Server-side state authority:
- Maintains canonical state
- Operation validation and execution
- State version tracking
- Incremental state updates

#### 4. OperationHistory (`server/src/undo/OperationHistory.js`)
Server-side undo/redo:
- Complete operation history per project
- User-specific undo/redo stacks
- Transaction-aware undo/redo
- Conflict detection for undo operations

#### 5. Database Layer
- **database.js**: Original sqlite3 implementation
- **database-better-sqlite3.js**: Better-sqlite3 alternative for Windows
- **init-database.js**: Database initialization and migration

Features:
- SQLite with WAL mode
- User management
- Project/canvas persistence  
- Operation history (without embedded data)
- File metadata with access tracking
- Thumbnail references
- Node layer ordering

## Data Flow

### Image Upload Flow (New Architecture)
1. User drops images on canvas
2. Images are uploaded via HTTP in batches (5 concurrent)
3. Server stores files and generates thumbnails
4. Upload completion returns serverUrl
5. Nodes are created with serverUrl reference only
6. WebSocket operations remain small (<100KB)

### Operation Flow (Server-Authoritative)
1. User performs action (e.g., move node)
2. OperationPipeline validates and queues operation
3. StateSyncManager applies operation **optimistically** on client
4. Operation sent to server (metadata only, no embedded data)
5. **Server validates operation size (<100KB) and authenticity**
6. **Server applies operation to authoritative state**
7. **Server broadcasts validated operation to all clients**
8. Remote clients apply server-validated operation
9. **If validation fails, client rolls back optimistic update**

### State Synchronization
1. Client connects to canvas
2. **Server sends current state from CanvasStateManager**
3. **Server state version included with all updates**
4. Incremental updates via server-validated operations
5. **Optimistic updates with rollback on failure**
6. **Automatic reconciliation on version mismatch**

### Undo/Redo Flow
1. User triggers undo/redo
2. ClientUndoManager sends request to server
3. Server's OperationHistory validates undo possibility
4. Server checks for conflicts with other users
5. Server applies undo/redo and generates reverse operations
6. State changes broadcast to all clients
7. Undo state synchronized across user's tabs

## Node System

### Base Node (`js/nodes/base-node.js`)
Abstract base class providing:
- Common properties (position, size, rotation)
- Event handling
- Serialization/deserialization
- Render lifecycle
- Loading states for async content

### Node Types
- **ImageNode** (`js/nodes/image-node.js`): 
  - Progressive image loading
  - LOD (Level of Detail) rendering
  - Server-based thumbnails
  - Aspect ratio preservation
  - Color correction support (tone curves, adjustments, color balance)
  - WebGL-accelerated rendering
- **VideoNode** (`js/nodes/video-node.js`): 
  - Video playback with controls
  - Thumbnail generation
  - Play/pause synchronization
  - Color correction support
- **TextNode** (`js/nodes/text-node.js`): 
  - WYSIWYG text editing
  - Font support
  - Real-time collaboration
- **GroupNode** (`js/nodes/group-node.js`):
  - Container for organizing nodes
  - Automatic bounds calculation
  - Drag-and-drop support
  - Animated transitions
  - Screen-space aware rendering

## Performance Optimizations

### Client-Side
- **Image Loading**:
  - HTTP uploads before node creation
  - Progressive thumbnail loading
  - Server-side thumbnail generation
  - Centralized caching system
  - Batched thumbnail requests
- **Rendering**:
  - WebGL hardware acceleration
  - Texture memory management
  - Pre-rendered LOD caching
  - Idle render optimization (no 60fps when static)
  - Dirty rectangle optimization
  - LOD based on zoom level
- **Operations**:
  - Optimistic updates
  - Operation queuing
  - Batch processing
  - Interaction-based undo grouping

### Server-Side
- **WebSocket Optimization**:
  - 100KB operation size limit
  - Compression for messages >1KB
  - 5-minute timeout for large operations
  - 50MB buffer for HTTP uploads
- **Database**:
  - SQLite WAL mode
  - Foreign key constraints
  - Automatic cleanup of old operations
  - No embedded base64 data in operations
- **File Handling**:
  - Concurrent thumbnail generation
  - WebP format for thumbnails
  - Static file caching

## Security Considerations

### Current Implementation
- CORS configuration for specific origins
- Environment-based CORS for LAN access
- Helmet.js security headers
- File upload validation (images/videos only)
- Operation size limits
- Socket.IO authentication
- Rate limiting ready (documentation provided)

### Production Requirements
- HTTPS enforcement
- JWT token authentication
- Rate limiting per user
- Input sanitization
- Permission system implementation
- XSS protection for text content

## Module Dependencies

```
CollaborativeArchitecture
├── NetworkLayer
├── OperationPipeline
├── StateSyncManager
├── ClientUndoManager
├── TransactionManager
├── ImageUploadCoordinator
├── ImageProcessingProgressManager
└── Canvas Integration
    ├── Node System
    ├── Selection Manager
    ├── Viewport Controller
    └── Render Pipeline
```

## Configuration

### Client Configuration
- **config.js**: Main configuration with dynamic host detection
- **keyboard-shortcuts.js**: Centralized keyboard shortcut definitions
- **state.js**: Global state management and feature flags

```javascript
const CONFIG = {
    SERVER: {
        HTTP_BASE: window.location.hostname === 'localhost' ? 
            'http://localhost:3000' : 
            `http://${window.location.hostname}:3000`,
        // Dynamic WebSocket URL for LAN support
    },
    FEATURES: {
        OPERATION_QUEUE: true,
        UNIFIED_NOTIFICATIONS: true,
        PROGRESSIVE_THUMBNAILS: true,
        WEBGL_RENDERER: true
    }
}
```

### Server Configuration
- Port: 3000 (configurable via PORT env)
- WebSocket timeout: 5 minutes
- Max operation size: 100KB
- Max HTTP buffer: 50MB
- Thumbnail sizes: 64, 128, 256, 512, 1024, 2048px
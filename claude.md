# ImageCanvas Project Documentation

## Project Overview

ImageCanvas is a high-performance, collaborative media canvas application that supports real-time multi-user editing, manipulation, and organization of images, videos, and text content. The project has evolved from a single-user canvas to a full-featured collaborative platform with enterprise-grade performance and reliability.

## Current Architecture

### Frontend Systems

**Canvas System (`js/canvas.js`)**
- Main rendering engine with viewport management
- Multi-selection and interaction handling
- Node manipulation (drag, resize, rotate)
- Keyboard shortcuts and input handling
- Real-time collaborative operation broadcasting

**Graph System (`js/graph.js`)**
- Node management and relationships
- State tracking and updates
- Performance monitoring
- Node factory pattern for extensibility

**Node Types (`js/nodes/`)**
- `BaseNode`: Foundation class with common functionality
- `ImageNode`: High-performance image rendering with LOD system
- `VideoNode`: Video playback with collaborative controls
- `TextNode`: WYSIWYG text editing with real-time sync

**Core Systems (`js/core/`)**
- `Selection`: Multi-selection with collaborative awareness
- `Handles`: Resize/rotate handle rendering and interaction
- `Viewport`: Camera controls and coordinate transformations
- `Alignment`: Auto-alignment and grid snapping
- `Animation`: Smooth transitions and spring physics

**Utilities (`js/utils/`)**
- `Cache`: Global image and thumbnail caching
- `State`: Undo/redo and persistence
- `Config`: Performance and behavior settings
- `Utils`: Helper functions and utilities

**Collaborative System (`js/collaborative.js`)**
- WebSocket connection management via Socket.IO
- Real-time operation broadcasting and receiving
- Periodic sync with conflict resolution
- Connection health monitoring with heartbeat
- User presence and session management
- Media upload integration

### Backend Systems

**Server Architecture (`server/`)**
```
server/
├── index.js              # Express + Socket.IO server
├── database/            # SQLite database files
│   └── canvas.db       # Main database with WAL mode
├── uploads/            # Uploaded media files
├── thumbnails/         # Generated thumbnails
├── projects/           # Project data storage
└── src/
    ├── database/
    │   └── database.js      # SQLite wrapper with transactions
    └── realtime/
        └── collaboration.js # Socket.IO collaboration manager
```

**Database Schema**
- `users`: User management with profiles
- `projects`: Project storage with metadata
- `project_versions`: Version history tracking
- `project_collaborators`: Permission management
- `operations`: Real-time operation log
- `active_sessions`: Live presence tracking
- `files`: Media metadata and hashing

**Collaboration Features**
- Real-time operational transformation
- Project room management
- User presence indicators
- Automatic session cleanup
- Media broadcast to collaborators
- Sync validation and recovery

## Implemented Features

### 1. Performance Optimization System

**Multi-Resolution LOD (Level of Detail)**
- 6-level thumbnail pyramid (64px → 2048px)
- Smart quality selection based on zoom and viewport
- Progressive loading with radial progress indicators
- Support for 40+ 4K images simultaneously

**Global Caching System**
- Shared thumbnails via content hashing
- Memory + IndexedDB persistence
- Queue management for generation
- Smart cache invalidation

**Non-Blocking Operations**
- Progressive file processing
- Yielding with `requestAnimationFrame`
- Real-time progress feedback
- Immediate UI responsiveness

### 2. Real-Time Collaboration

**Operation Types**
- `node_create`: Node creation with properties
- `node_update`: Position, size, rotation changes
- `node_delete`: Node removal
- `node_property_update`: Individual property sync
- `selection_change`: Multi-user selection awareness
- `viewport_change`: Camera position sharing
- `layer_order_change`: Z-index management
- `video_toggle`: Video playback control
- `text_edit`: Real-time text changes

**Collaboration Features**
- Socket.IO WebSocket communication
- Operational transformation for conflicts
- Sequence number tracking
- Periodic sync with state validation
- Automatic reconnection handling
- Graceful offline/online transitions

**User Presence**
- Active user list display
- Connection status indicators
- User avatars and names
- Real-time cursor tracking (ready for implementation)
- Selection highlighting for other users

### 3. Advanced Node System

**Image Nodes**
- High-performance rendering with LOD
- Thumbnail caching and sharing
- Smooth scaling and rotation
- Collaborative transform operations

**Video Nodes**
- Full playback controls (play/pause, loop, mute, autoplay)
- Multi-video selection controls
- Thumbnail from first frame
- Collaborative property sync
- Support for MP4, WebM, OGG, MOV, GIF

**Text Nodes**
- WYSIWYG in-place editing
- Real-time collaborative text sync
- Font, color, alignment customization
- Auto-resize with word wrapping
- Background color with transparency

### 4. Selection & Interaction

**Multi-Selection System**
- Shift+click for additive selection
- Rectangle selection with drag
- Group operations (move, resize, rotate)
- Multi-user selection awareness

**Advanced Resize Modes**
- Individual node resize
- Bounding box group resize
- Delta scaling for multi-selection
- Rotated node support

**Alignment Features**
- Horizontal/vertical alignment (1, 2 keys)
- Grid snap with Ctrl/Cmd+Shift+drag
- Auto-align with Shift+drag
- Spring physics animations

### 5. Media Management

**File Upload System**
- Drag & drop support
- Server-side processing with Sharp
- Automatic thumbnail generation
- Hash-based deduplication
- Collaborative media broadcast

**Format Support**
- Images: JPEG, PNG, WebP, BMP
- Videos: MP4, WebM, OGG, MOV, GIF
- Optimized loading strategies
- Cross-origin support

### 6. State Management

**Undo/Redo System**
- 20-level history with size limits
- Thumbnail preservation
- Efficient state restoration
- Memory management

**Persistence**
- LocalStorage for single-user mode
- Server-side project storage
- State serialization/deserialization
- Export/import capabilities

## User Interface

### Keyboard Shortcuts
- **Navigation**: Mouse wheel zoom, drag to pan
- **Zoom**: = (2x in), - (0.5x out), F (fit), H (home)
- **Canvas Management**: Ctrl/Cmd+O (open navigator), Ctrl/Cmd+S (save)
- **Creation**: T (text node)
- **Editing**: Double-click nodes, Escape to exit
- **Selection**: Shift+click, rectangle drag
- **Duplication**: Alt+drag, Ctrl/Cmd+D
- **Clipboard**: Ctrl/Cmd+C/V
- **Deletion**: Delete/Backspace
- **Layers**: [ ] (move up/down)
- **Alignment**: 1 (horizontal), 2 (vertical)
- **Toggles**: Shift+T (titles)

### Mouse Interactions
- **Pan**: Ctrl/Cmd+drag or middle mouse
- **Select**: Click or drag rectangle
- **Move**: Drag nodes
- **Resize**: Drag handles
- **Rotate**: Drag rotation handle
- **Duplicate**: Alt+drag
- **Context**: Right-click menu (planned)

## Technical Implementation

### Performance Optimizations
- Visibility culling for off-screen nodes
- Dynamic LOD selection
- Batch rendering operations
- Progressive loading strategies
- Efficient state updates

### Collaborative Architecture
- WebSocket connection with Socket.IO
- Operational transformation for conflicts
- Sequence-based operation ordering
- Periodic sync validation
- Connection health monitoring

### Security & Reliability
- Path traversal protection
- File type validation
- Size limits enforcement
- Automatic session cleanup
- Graceful error recovery

## Development Setup

### Prerequisites
- Node.js 16+ 
- Python 3 (for development server)
- Modern browser with ES6 support

### Installation
```bash
# Install dependencies
npm install

# Initialize database (first time only)
node server/src/database/database.js

# Start collaborative server
npm run dev

# In another terminal, serve the client
npm run serve-client
```

### Configuration
The server runs on port 3000 by default. Client development server runs on port 8000.

### Testing Collaboration
1. Start the collaborative server
2. Open multiple browser windows
3. Navigate to http://localhost:8000/demo.html
4. All windows auto-join the "demo-project"

## Architecture Decisions

### Why SQLite?
- Zero-configuration deployment
- Excellent performance for local networks
- Built-in transaction support
- Single file backup
- WAL mode for concurrency

### Why Socket.IO?
- Proven reliability for real-time apps
- Automatic reconnection
- Room-based isolation
- Binary data support
- Fallback mechanisms

### Why Sharp for Images?
- Native performance
- Extensive format support
- Stream processing
- Memory efficient
- WebP generation

## Debug Commands

### Console Access
```javascript
window.app              // Main application instance
window.lcanvas         // Canvas instance
window.thumbnailCache  // Thumbnail cache
window.imageCache      // Image cache
window.collaborativeManager // Collaboration instance
```

### Performance Monitoring
```javascript
// Thumbnail cache statistics
window.thumbnailCache.getStats()

// Active operations
window.collaborativeManager.operationQueue

// Connection status
window.collaborativeManager.isConnected
```

## Known Limitations

### Current Implementation
- Text rotation not supported
- No custom fonts upload yet
- Limited to 20 undo levels
- No cloud storage integration
- Basic conflict resolution

### Planned Features
- Advanced drawing tools
- Filter system with WebGL
- Version branching/merging
- Cloud storage adapters
- Plugin architecture

## Performance Benchmarks

### Single User
- 40+ 4K images: <16ms frame time
- Instant node duplication
- <1s project load
- Non-blocking operations

### Collaborative
- 10+ concurrent users tested
- <50ms operation latency
- <100ms sync validation
- Automatic recovery from disconnections

## Recent Updates

### July 2025
- Enhanced video collaborative controls
- Multi-node property sync
- Individual property broadcasting
- Multi-video selection controls

### February 2025
- Fixed text/video property sync
- Real-time text editing broadcast
- Complete property serialization
- Node-specific behavior handling

### January 2025
- Resolved sync validation issues
- Fixed database schema inconsistencies
- Improved Socket.IO loading strategy
- Enhanced error handling

## Best Practices

### Performance
1. Use thumbnail system for previews
2. Implement progressive loading
3. Batch similar operations
4. Cache expensive calculations
5. Yield for long operations

### Collaboration
1. Always broadcast state changes
2. Include operation metadata
3. Handle offline scenarios
4. Validate incoming operations
5. Maintain operation order

### Code Quality
1. Follow existing patterns
2. Add error boundaries
3. Document complex logic
4. Test with multiple users
5. Monitor performance

---

ImageCanvas represents a modern approach to collaborative media editing, combining high performance with real-time multi-user capabilities. The architecture prioritizes user experience while maintaining professional-grade reliability and extensibility.
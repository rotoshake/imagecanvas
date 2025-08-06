# ImageCanvas Documentation

## Overview

ImageCanvas is a high-performance, collaborative media canvas application built with LiteGraph.js. It supports real-time multi-user editing, image/video manipulation, and provides a robust undo/redo system with server-authoritative state management.

## Documentation Structure

### Core Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Complete system architecture overview
  - Frontend and backend components
  - Data flow diagrams
  - Performance optimizations
  - Security considerations

- **[DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md)** - Getting started guide for developers
  - Installation and setup
  - Creating custom nodes and commands
  - Testing and debugging
  - Deployment checklist

- **[FEATURES.md](./FEATURES.md)** - Comprehensive feature list
  - Current capabilities
  - UI components
  - Planned features

### System Components

- **[UNDO_SYSTEM.md](./UNDO_SYSTEM.md)** - Complete undo/redo system documentation
  - Server-authoritative architecture
  - Multi-user conflict handling
  - Transaction support
  - API reference

- **[IMAGE_UPLOAD_SYSTEM.md](./IMAGE_UPLOAD_SYSTEM.md)** - HTTP-based image upload system
  - Upload flow and architecture
  - Hash-based deduplication
  - Progressive thumbnail loading
  - Unified progress tracking

- **[NAVIGATION_STATE_PERSISTENCE.md](./NAVIGATION_STATE_PERSISTENCE.md)** - Viewport state management
  - Automatic save/restore of zoom and pan
  - Per-canvas persistence
  - Debounced updates

- **[UNIFIED_NOTIFICATIONS.md](./UNIFIED_NOTIFICATIONS.md)** - Notification system documentation
  - API usage
  - Visual design
  - Integration points

- **[BULK_OPERATIONS_ARCHITECTURE.md](./BULK_OPERATIONS_ARCHITECTURE.md)** - Large-scale operations handling
  - Multi-tier operation system
  - Performance optimizations
  - Background sync

- **[IMAGE_LOADING_MASTER_PLAN.md](./IMAGE_LOADING_MASTER_PLAN.md)** - Image loading implementation
  - Progressive loading strategy
  - Caching system
  - Performance considerations

### Reference

- **[API_REFERENCE.md](./API_REFERENCE.md)** - API endpoints and WebSocket events
- **[PERFORMANCE.md](./PERFORMANCE.md)** - Performance optimization guide
- **[KEYBOARD_SHORTCUTS.md](./KEYBOARD_SHORTCUTS.md)** - Keyboard shortcuts reference
- **[GROUP_NODE_SYSTEM.md](./GROUP_NODE_SYSTEM.md)** - Group node documentation
- **[COLOR_CORRECTION_SYSTEM.md](./COLOR_CORRECTION_SYSTEM.md)** - Color correction features
- **[WEBGL_RENDERING_SYSTEM.md](./WEBGL_RENDERING_SYSTEM.md)** - WebGL renderer details
- **[Z_ORDER_LAYER_SYSTEM.md](./Z_ORDER_LAYER_SYSTEM.md)** - Layer management system
- **[CHANGELOG_2025.md](./CHANGELOG_2025.md)** - Recent changes and updates

## Key Technologies

- **Frontend**: LiteGraph.js, ES6 modules, Canvas API
- **Backend**: Node.js, Express, Socket.IO
- **Database**: SQLite with WAL mode
- **Real-time**: WebSocket with Socket.IO
- **File Storage**: Local filesystem with hash-based deduplication

## Recent Major Updates (2025)

### Group Node System
- Container nodes for organizing content
- Drag-and-drop node management
- Automatic bounds calculation with animations
- Screen-space aware title bars
- Parent-child relationship preservation

### Advanced Color Correction
- Floating color correction panel with tone curves
- Color adjustments (brightness, contrast, saturation, etc.)
- Color balance wheels for shadows/midtones/highlights
- Per-section bypass controls
- WebGL-accelerated processing

### Performance Optimizations
- WebGL renderer with texture caching
- LOD system with pre-rendered textures
- Memory management and limits
- Eliminated idle 60fps rendering
- Batched thumbnail requests

### Z-Order Layer System  
- Full layer control with keyboard shortcuts
- Group-aware layer management
- Server-synchronized layer order

### Keyboard Shortcuts System
- Centralized, configurable shortcuts
- Platform-aware (Cmd/Ctrl mapping)
- Custom shortcut persistence
- Built-in test interface

### Admin Panel
- Database cleanup and maintenance
- Thumbnail management
- System information display
- Browser cache control

### Enhanced Compatibility
- Better-SQLite3 support for Windows
- LAN access with dynamic host detection
- Environment-based CORS configuration

### Previous Major Updates

#### Collaborative Undo/Redo System
- Server-authoritative undo/redo with full history
- Multi-user conflict detection
- Transaction support for atomic operations
- Cross-tab synchronization
- Interaction-based grouping for real-time changes

#### HTTP Image Upload System
- Images uploaded via HTTP before node creation
- Prevents WebSocket timeouts with large files
- Batch upload support with progress tracking
- Server-side thumbnail generation

#### Unified Progress & Notifications
- Consolidated notification system
- Progress tracking for long operations
- Network status integration
- Improved user feedback

## Getting Started

See the [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md) for installation and setup instructions.

## Contributing

This project follows standard open source contribution guidelines. Please ensure all code follows the existing patterns and includes appropriate documentation.
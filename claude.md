# ImageCanvas Project Documentation

## Project Overview

ImageCanvas is a high-performance, modular image/video canvas application that supports real-time editing, manipulation, and organization of media content. The project has evolved from a basic image canvas to a sophisticated system with advanced performance optimizations, multi-selection capabilities, and professional-grade features.

## Architecture Overview

### Core Systems

**Canvas System (`js/canvas.js`)**
- Main rendering engine with viewport management
- Multi-selection and interaction handling
- Node manipulation (drag, resize, rotate)
- Keyboard shortcuts and input handling

**Graph System (`js/graph.js`)**
- Node management and relationships
- State tracking and updates
- Performance monitoring

**Node Types (`js/nodes/`)**
- `BaseNode`: Foundation class with common functionality
- `ImageNode`: High-performance image rendering with LOD system
- `VideoNode`: Video playback with thumbnail generation
- `TextNode`: WYSIWYG text editing with word wrapping

**Core Systems (`js/core/`)**
- `Selection`: Multi-selection management
- `Handles`: Resize/rotate handle rendering and interaction
- `Viewport`: Camera controls and coordinate transformations
- `Alignment`: Auto-alignment and grid snapping
- `Animation`: Smooth transitions and spring physics

**Utilities (`js/utils/`)**
- `Cache`: Global image and thumbnail caching
- `State`: Undo/redo and persistence
- `Config`: Performance and behavior settings
- `Utils`: Helper functions and utilities

## Major Features Implemented

### 1. Performance Optimization System

**Multi-Resolution LOD (Level of Detail) System**
- 6-level thumbnail pyramid (64px → 2048px)
- Smart quality selection based on screen size and zoom level
- Reduced frame times from 4300ms to immediate UI responsiveness
- Support for 40+ 4K images simultaneously

**Global Thumbnail Cache**
- Shared thumbnails between nodes with same hash
- Prevents duplicate generation during copy/paste/duplication
- Queue management to avoid concurrent generation
- Progressive loading with essential thumbnails first

**Non-Blocking Thumbnail Generation**
- Uses `requestAnimationFrame` and `setTimeout` for yielding
- Phase 1: Essential small thumbnails (64px, 128px) immediately
- Phase 2: Larger thumbnails (256px-2048px) with progressive delays
- Real-time progress feedback with radial progress rings

### 2. Advanced Selection System

**Multi-Selection Capabilities**
- Shift+click for additive selection
- Rectangle selection with drag
- Visual feedback with selection bounding box
- Group operations (move, resize, rotate, align)

**Selection Handle System**
- Scale handles on all 8 cardinal/diagonal directions
- Rotation handles with visual feedback
- Dynamic cursor updates based on node rotation
- Screen-space aware handle sizing

**Coordinate System Management**
- World vs local coordinate transformations
- Proper handling of rotated nodes
- Anchor point calculations for scaling operations

### 3. Dynamic Bounding Box System

**Real-time Updates**
- Bounding box updates during group rotations
- Cache invalidation during alignment operations
- Support for rotated nodes in bounding box calculations

**Smart Caching**
- Strategic cache invalidation at key interaction points
- Performance optimization while maintaining accuracy
- Automatic updates during animations

### 4. Advanced Resize Behavior

**Three Distinct Resize Modes**
1. **Individual Node Resize**: Single selection with proper anchor points
2. **Bounding Box Group Resize**: Multi-selection bounding box scaling
3. **Delta Scaling**: Multi-selection individual handle scaling

**Rotated Node Support**
- Coordinate transformation between world and local space
- Proper drag direction handling for rotated nodes
- Dynamic cursor feedback mapping rotation to 8 directions
- Anchor point preservation during scaling

### 5. Alignment and Animation System

**Auto-Alignment Features**
- Horizontal and vertical alignment (1, 2 keys)
- Grid alignment with Ctrl/Cmd+Shift+drag
- Auto-align with Shift+drag on empty space
- Spring physics for smooth movements

**Animation System**
- Grid-align animations with proper bounding box updates
- Spring-based physics with configurable parameters
- Multiple animation layers (grid, auto-align, selection)

### 6. File Format Support

**Image Formats**
- JPEG, PNG, WebP, BMP support
- Optimized loading with `img.decode()` for better performance
- Cross-origin and loading hints for performance

**Video Formats**
- MP4, WebM, OGG, MOV (QuickTime) support
- GIF treated as video for animated playback
- Automatic thumbnail generation from first frame
- Playback controls and state management

### 7. Text Editing System

**WYSIWYG Editing**
- In-place text editing with overlay system
- Real-time preview with matching fonts and styling
- Word wrapping with automatic height adjustment
- Escape/Enter key handling for editing flow

**Text Properties**
- Font family, size, color customization
- Text alignment (left, center, right)
- Background color with alpha transparency
- Padding and leading factor controls

### 8. State Management

**Undo/Redo System**
- 20-level undo stack with size limits
- Automatic state saving during operations
- Efficient state restoration with thumbnail preservation
- Memory management with cleanup

**Persistence**
- Auto-save to localStorage
- State serialization/deserialization
- Cross-session state recovery
- Export/import capabilities

## Performance Improvements Achieved

### Before Optimization
- **Frame Times**: 4300ms during heavy operations
- **UI Responsiveness**: Blocking during image drops
- **Duplication**: 500ms+ with full thumbnail regeneration
- **Memory Usage**: Linear growth with duplicate nodes

### After Optimization
- **Frame Times**: Immediate UI responsiveness
- **UI Responsiveness**: Non-blocking operations
- **Duplication**: Instant with thumbnail reuse
- **Memory Usage**: Shared thumbnails reduce memory footprint

### Specific Optimizations

**Thumbnail System**
- Global cache prevents duplicate generation
- Progressive loading maintains UI responsiveness
- Essential thumbnails (64px, 128px) generated immediately
- Larger thumbnails generated with yielding

**File Processing**
- `requestAnimationFrame` yielding during drag & drop
- Progressive file processing for multiple files
- Real-time progress feedback
- Immediate node creation with deferred thumbnail generation

**Node Operations**
- Instant duplication with thumbnail sharing
- Copy/paste reuses existing thumbnails
- State restoration preserves thumbnail cache
- Smart cache invalidation strategies

## User Interface Features

### Keyboard Shortcuts
- **Navigation**: Mouse wheel zoom, drag to pan
- **Quick Zoom**: = (2x zoom in), - (0.5x zoom out)
- **View Controls**: F (fit to view), H (home/reset)
- **Node Creation**: T (text node)
- **Editing**: Double-click (title/text editing)
- **Selection**: Shift+click (multi-select)
- **Duplication**: Alt+drag, Ctrl/Cmd+D
- **Copy/Paste**: Ctrl/Cmd+C, Ctrl/Cmd+V
- **Deletion**: Delete/Backspace
- **Layer Order**: [ ] (move up/down)
- **Alignment**: 1 (horizontal), 2 (vertical)
- **Title Toggle**: Shift+T

### Mouse Interactions
- **Pan**: Ctrl/Cmd+drag or middle mouse
- **Select**: Click node or drag rectangle
- **Move**: Drag node or selection
- **Resize**: Drag corner/edge handles
- **Rotate**: Drag rotation handle
- **Duplicate**: Alt+drag
- **Alignment**: Shift+drag empty space (auto-align)
- **Grid Align**: Ctrl/Cmd+Shift+drag

### Visual Feedback
- **Selection**: Highlighted borders and handles
- **Progress**: Radial progress rings for loading
- **Cursors**: Dynamic cursor feedback based on context
- **Alignment**: Grid overlay during alignment operations
- **Animation**: Smooth spring-based movements

## Technical Architecture

### Rendering Pipeline
1. **Visibility Culling**: Only render nodes in viewport
2. **LOD Selection**: Choose appropriate thumbnail quality
3. **Batch Operations**: Minimize canvas state changes
4. **Progressive Loading**: Show content as it becomes available

### Memory Management
- **Thumbnail Cache**: Global sharing with LRU eviction
- **Image Cache**: Memory + IndexedDB persistence
- **State Management**: Size limits with cleanup
- **Resource Cleanup**: Proper disposal of media objects

### Error Handling
- **Graceful Degradation**: Fallbacks for unsupported features
- **Error Recovery**: Automatic retry mechanisms
- **User Feedback**: Clear error messages and progress indicators
- **Debug Tools**: Console commands for monitoring performance

## Debug and Monitoring

### Console Commands
- `window.thumbnailCache.getStats()`: Thumbnail cache statistics
- `window.imageCache`: Access image cache
- `window.app`: Main application instance
- `window.lcanvas`: Canvas instance

### Performance Monitoring
- **Frame Time Logging**: Identifies slow operations
- **Cache Hit Rates**: Monitors thumbnail efficiency
- **Memory Usage Tracking**: Prevents memory leaks
- **Load Time Metrics**: Optimizes user experience

## Development Patterns

### Code Organization
- **Modular Architecture**: Clear separation of concerns
- **Event-Driven**: Loose coupling between systems
- **Performance-First**: Optimizations built into core systems
- **Extensible**: Easy to add new node types and features

### Testing Strategy
- **Real-world Testing**: 40+ 4K images
- **Performance Benchmarks**: Frame time monitoring
- **User Experience**: Responsive interaction testing
- **Edge Cases**: Error handling and recovery

### Future Extensibility
- **Plugin System**: Easy addition of new node types
- **Customizable**: Configurable performance parameters
- **Scalable**: Architecture supports large projects
- **Maintainable**: Clean code with comprehensive documentation

## Known Optimizations and Best Practices

### Performance Best Practices
1. **Lazy Loading**: Generate thumbnails only when needed
2. **Progressive Enhancement**: Essential features first, enhancements later
3. **Memory Efficiency**: Share resources between similar objects
4. **UI Responsiveness**: Always yield control to prevent blocking
5. **Smart Caching**: Cache expensive operations with proper invalidation

### Code Quality Practices
1. **Single Responsibility**: Each class has a clear purpose
2. **Dependency Injection**: Loose coupling between components
3. **Error Boundaries**: Graceful handling of exceptions
4. **Documentation**: Comprehensive inline and external docs
5. **Testing**: Real-world scenarios and edge cases

This documentation represents the culmination of extensive performance optimization, feature development, and architectural improvements that transform ImageCanvas from a basic prototype into a professional-grade media editing application. 
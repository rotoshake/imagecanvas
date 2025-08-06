# ImageCanvas Changelog 2025

## Major Features and Improvements

### Performance Optimizations
- **Major Fix**: Eliminated unnecessary 60fps idle rendering, significantly reducing CPU/GPU usage when canvas is static
- **WebGL Rendering System**: Complete GPU-accelerated rendering pipeline with texture caching
- **LOD Caching**: Pre-rendered textures at multiple zoom levels for instant display
- **Memory Management**: Automatic texture memory limits (512MB desktop, 128MB mobile)
- **Batch Operations**: Thumbnail requests now batched for reduced server load

### Group Node System
- **Container Nodes**: New group node type for organizing related content
- **Visual Design**: Semi-transparent containers with draggable title bars
- **Smart Bounds**: Automatic boundary calculation with smooth animations
- **Screen-Space Awareness**: Title bar adapts to zoom level (thin bar when zoomed out)
- **Drag & Drop**: Intuitive node management with 70% overlap detection
- **Parent-Child Preservation**: Maintains relationships during copy/paste operations

### Advanced Color Correction
- **Floating Panel**: Draggable color correction interface with persistent state
- **Tone Curves**: Spline-based tone curve editor with Catmull-Rom interpolation
- **Color Adjustments**: Brightness, contrast, saturation, hue, temperature, tint controls
- **Color Balance Wheels**: Professional three-way color grading (shadows/midtones/highlights)
- **GPU Acceleration**: All corrections processed in WebGL shaders
- **Per-Section Bypass**: Toggle individual correction types for A/B comparison
- **Real-Time Collaboration**: Color corrections sync across all users

### Z-Order Layer System
- **Layer Control**: Fine-grained control over node rendering order
- **Keyboard Shortcuts**: [ ] for layer navigation, Shift+[ ] for send to back/front
- **Group Integration**: Respects group hierarchies in layer ordering
- **Server Persistence**: Layer order saved and synchronized

### Keyboard Shortcuts System
- **Centralized Configuration**: All shortcuts defined in one place
- **Customizable**: Override defaults programmatically with persistence
- **Platform Aware**: Automatic Cmd/Ctrl key mapping
- **Test Interface**: Built-in HTML page for testing shortcuts
- **Categories**: Organized by function (navigation, selection, operations, etc.)

### Admin Panel
- **Database Management**: Cleanup orphaned files, view size, optimize storage
- **Thumbnail Management**: Scan and regenerate missing thumbnails
- **Browser Cache Control**: Clear IndexedDB and local caches
- **Grace Period Settings**: Configure file retention policies
- **Full Wipe Option**: Alt+click for complete database reset

### Enhanced Compatibility
- **Better-SQLite3 Support**: Alternative database driver for Windows compatibility
- **LAN Access**: Dynamic host detection for local network access
- **Environment-Based CORS**: Secure configuration for different environments
- **Vite Dev Server**: LAN access enabled by default for development

### Security Enhancements
- **Rate Limiting**: Documentation and implementation guidance
- **CORS Configuration**: Environment-based for flexible but secure access
- **Input Validation**: Improved validation across all endpoints
- **Security Headers**: Helmet.js properly configured

## Bug Fixes

### Critical Fixes
- **Group Node Containment**: Fixed logic to prevent accidental node transfers
- **Color Correction Sync**: Live updates now work across all connected users
- **Database Compatibility**: Added better-sqlite3 alternative for Windows issues
- **Parent-Child Relationships**: Fixed preservation during copy/paste operations
- **Double Color Correction**: Fixed issue with corrections being applied twice
- **Video Playback Stuttering**: Optimized texture upload to prevent frame drops

### Minor Fixes
- **LAN WebSocket Connection**: Now uses dynamic host for proper connectivity
- **Database Column Names**: Corrected upload endpoint column references
- **Missing Methods**: Added getCanvas() and getUser() to better-sqlite3 implementation
- **Import Paths**: Fixed OperationHistory import in various modules
- **Texture Memory Leaks**: Proper cleanup of WebGL resources

## Technical Improvements

### Architecture
- **Modular Rendering**: Separated WebGL renderer from main canvas code
- **Texture Management**: Dedicated TextureLODManager for GPU resources
- **Component Organization**: New UI components directory structure
- **Database Abstraction**: Support for multiple database drivers

### Code Quality
- **Type Definitions**: Improved JSDoc types throughout codebase
- **Error Handling**: Better error messages and recovery strategies
- **Memory Safety**: Proper disposal of GPU resources and event listeners
- **Performance Monitoring**: Built-in metrics for rendering performance

### Developer Experience
- **Documentation**: Comprehensive docs for all new systems
- **Debug Tools**: Enhanced debugging capabilities for WebGL and performance
- **Test Pages**: Interactive test pages for keyboard shortcuts and features
- **Configuration**: Cleaner config structure with environment support

## Migration Notes

### For Developers
1. **WebGL Rendering**: Now enabled by default, disable with `FEATURES.WEBGL_RENDERER = false`
2. **Database Driver**: Can switch to better-sqlite3 by changing import in server
3. **Keyboard Shortcuts**: Old inline handlers should migrate to new system
4. **Color Corrections**: Node properties structure changed, automatic migration on load

### For Users
1. **Performance**: Significant improvements, especially when canvas is idle
2. **New Features**: Press 'G' to group nodes, 'C' for color correction
3. **Keyboard Shortcuts**: Many new shortcuts available, customizable
4. **LAN Access**: Can now access from other devices on local network

## Known Issues
- Color balance panel position may reset on browser refresh
- Large texture uploads may cause temporary frame drops
- Group animations may conflict with alignment system
- Some keyboard shortcuts may conflict with browser defaults

## Future Roadmap
- WebGL2 support for enhanced performance
- Texture compression for reduced memory usage
- Advanced masking for local color corrections
- Nested group collapse/expand functionality
- Plugin system for custom node types
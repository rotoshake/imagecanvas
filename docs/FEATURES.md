# ImageCanvas Features

## Core Functionality

### Canvas Operations
- **Pan & Zoom**: Navigate the infinite canvas with mouse or trackpad
- **Node Selection**: Single and multi-select with rectangle selection
- **Node Manipulation**: Move, resize, rotate, and transform nodes
- **Clipboard Operations**: Cut, copy, paste with full undo support
- **Grid Snapping**: Optional grid alignment for precise layouts

### Real-Time Collaboration
- **Multi-User Editing**: Multiple users can edit the same canvas simultaneously
- **Presence Indicators**: See other users' cursors and selections
- **Conflict Resolution**: Server-authoritative state prevents conflicts
- **Multi-Tab Support**: Same user can have multiple tabs open
- **Automatic Reconnection**: Seamless recovery from connection drops

### Media Support

#### Images
- **Format Support**: JPEG, PNG, WebP, GIF (static)
- **HTTP Upload System**: Images uploaded via HTTP before node creation
- **Progressive Loading**: Thumbnails load progressively based on zoom
- **Server Thumbnails**: 6 sizes (64px to 2048px) generated server-side
- **Hash-Based Deduplication**: Same image uploaded multiple times uses single file
- **Batch Upload**: Upload multiple images simultaneously with progress tracking

#### Videos
- **Format Support**: MP4, WebM, MOV
- **Playback Controls**: Play/pause/seek directly on canvas
- **Thumbnail Generation**: Automatic video poster frames
- **Synchronized Playback**: Video state syncs across users

#### Text
- **Rich Text Editing**: WYSIWYG text nodes
- **Font Support**: System fonts and custom fonts
- **Real-Time Sync**: Text changes sync character by character

### Undo/Redo System
- **Full History**: Complete undo/redo for all operations
- **Server-Authoritative**: Undo history maintained server-side
- **Multi-User Aware**: Conflict detection when undoing in collaborative sessions
- **Transaction Support**: Group related operations for atomic undo
- **Cross-Tab Sync**: Undo state synchronized across user's tabs
- **Visual Feedback**: Shows what will be undone/redone
- **Interaction-Based Undo**: Groups related real-time changes (e.g., dragging) into single undo entries

### User Interface

#### Floating Color Correction Panel
- **Tone Curve Editor**: Spline-based tone curve adjustment
- **Color Adjustments**: Brightness, contrast, saturation, hue, temperature, tint
- **Color Balance Wheels**: Shadows, midtones, highlights with YRGB controls
- **Per-Section Bypass**: Toggle individual correction sections
- **Real-Time Updates**: Live preview of adjustments
- **Persistent State**: Remembers panel position and visibility

#### Admin Panel
- **Database Management**: Cleanup orphaned files and optimize storage
- **Thumbnail Management**: Scan and regenerate missing thumbnails
- **System Information**: View connection status and session details
- **Browser Cache Control**: Clear IndexedDB and local caches
- **Grace Period Settings**: Configure file retention policies

#### Unified Notifications
- **Consolidated System**: All notifications in one consistent UI
- **Types**: Success, error, warning, info messages
- **Progress Tracking**: Visual progress bars for operations
- **Network Status**: Connection state integrated into notifications
- **Persistent Messages**: Important notifications that don't auto-dismiss

#### Canvas Navigator
- **Project Browser**: List and manage all projects
- **Quick Access**: Recent projects and quick switching
- **Project Management**: Create, rename, delete projects
- **Database Maintenance**: Built-in cleanup tools

#### Floating Properties Inspector
- **Context-Sensitive**: Shows properties for selected nodes
- **Live Updates**: Changes apply immediately
- **Multi-Select Support**: Edit common properties of multiple nodes
- **Draggable UI**: Position anywhere on screen
- **Auto-Hide**: Hides when no selection

### Group Nodes
- **Container System**: Group multiple nodes together for organization
- **Drag to Add**: Drag nodes into groups to add them
- **Nested Groups**: Support for groups within groups
- **Visual Boundaries**: Automatic bounds calculation with padding
- **Title Bar**: Draggable title bar with customizable name
- **Animation**: Smooth transitions when resizing or adding nodes
- **Screen-Space Aware**: Title bar adjusts based on zoom level
- **Parent-Child Relationships**: Maintains hierarchy during copy/paste

### Z-Order Layer System
- **Layer Control**: Move nodes up/down in rendering order
- **Keyboard Shortcuts**: [ and ] for layer navigation
- **Bring to Front/Back**: Shift+] and Shift+[ for extremes
- **Group-Aware**: Respects group hierarchies
- **Server Synchronized**: Layer order persists across sessions

### Performance Features

#### Rendering Optimizations
- **WebGL Renderer**: Hardware-accelerated image rendering
- **Texture Caching**: Efficient GPU texture management
- **LOD System**: Multiple detail levels based on zoom
- **Cached Rendering**: Pre-rendered LOD textures for performance
- **Memory Management**: Automatic texture cleanup and limits
- **Idle Optimization**: Eliminates unnecessary 60fps rendering when idle

#### Image Loading Optimization
- **Level of Detail (LOD)**: Load appropriate resolution based on zoom
- **Lazy Loading**: Only load visible images
- **Thumbnail Caching**: Client and server-side caching
- **Progressive Enhancement**: Show low-res while loading high-res

#### Operation Optimization
- **Optimistic Updates**: Immediate UI response with server reconciliation
- **Operation Queuing**: Sequential execution prevents conflicts
- **Batch Processing**: Group operations for efficiency
- **Size Limits**: 100KB max operation size prevents timeouts

#### Bulk Operations
- **Smart Chunking**: Large operations split into manageable pieces
- **Progress Feedback**: Visual progress for long operations
- **Background Sync**: Operations continue even if UI is closed
- **Adaptive Performance**: Chunk size adjusts to network conditions

### Data Management

#### Persistence
- **Auto-Save**: Changes saved automatically
- **SQLite Database**: Reliable local storage with WAL mode
- **Navigation State**: Zoom and pan position saved per canvas
- **File Management**: Automatic cleanup of orphaned files

#### Import/Export
- **Drag & Drop**: Drop images/videos directly onto canvas
- **Bulk Import**: Import multiple files at once
- **State Export**: Export canvas state for backup

### Keyboard Shortcuts System
- **Centralized Configuration**: All shortcuts in one place
- **Customizable**: Override defaults programmatically
- **Platform-Aware**: Automatic Cmd/Ctrl mapping
- **Categories**: Organized by function (navigation, selection, etc.)
- **LocalStorage Persistence**: Custom shortcuts saved across sessions
- **Test Interface**: Built-in testing page for shortcuts

### Better-SQLite3 Support
- **Windows Compatibility**: Alternative to node-sqlite3
- **Synchronous API**: Simpler error handling
- **Better Performance**: Up to 3x faster for some operations
- **Drop-in Replacement**: Same API interface

### LAN Access Support
- **Dynamic Host Detection**: Automatically uses correct IP
- **CORS Configuration**: Environment-based for security
- **WebSocket Compatibility**: Works across local network
- **Vite Dev Server**: LAN access enabled by default

### Developer Features

#### Architecture
- **Command Pattern**: All operations use consistent command interface
- **Event System**: Comprehensive event hooks for extensions
- **Module System**: Clean separation of concerns
- **Type Definitions**: JSDoc types for better IDE support

#### Debugging
- **Debug Mode**: Verbose logging for development
- **State Inspector**: Examine canvas state in console
- **Network Monitor**: Track all WebSocket operations
- **Performance Metrics**: Built-in performance monitoring

### Security Features
- **CORS Protection**: Configured for specific origins
- **File Validation**: Only allowed file types accepted
- **Size Limits**: Prevent DoS through large uploads
- **Operation Validation**: Server validates all operations
- **Helmet.js**: Security headers for production

## Recent Major Features

### Texture Memory Optimization (2025)
- Automatic memory limits based on device
- Texture disposal and cleanup
- Memory usage tracking
- Automatic quality reduction when near limits

### Gallery View Animations (2025)
- Smooth transitions between images
- Ken Burns effect support
- Keyboard navigation
- Touch gesture support

### Security Enhancements (2025)
- Rate limiting documentation
- Secure default configurations
- Input validation improvements
- CORS security headers

## Planned Features

### Authentication & Permissions
- User authentication system
- Per-project permissions
- Public/private projects
- Guest access controls

### Advanced Editing
- Layers and groups
- Alignment tools
- Transform handles
- Blend modes

### Export Options
- PDF export
- Image sequence export
- Project templates
- Backup/restore

### Performance
- WebGL rendering
- Virtual scrolling for huge canvases
- Streaming for large media
- CDN integration
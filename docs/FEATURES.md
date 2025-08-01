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

### User Interface

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

### Performance Features

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
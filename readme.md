# ImageCanvas

A high-performance, real-time collaborative canvas for images, videos, and text with professional-grade features.

## Quick Start

### 1. Start the Collaborative Server
```bash
# Install dependencies
npm install

# Start the server
npm start
# Server runs on http://localhost:3000
```

### 2. Start the Client
```bash
# In a new terminal
npm run serve-client
# Client runs on http://localhost:8000
```

### 3. Open the Application
- **Main app**: `http://localhost:8000`
- Open multiple tabs to test real-time collaboration

## Features

### Core Canvas Features
- **Drag & drop** images and videos to add them to the canvas
- **Node manipulation**:
  - Move by dragging
  - Alt+drag to duplicate
  - Resize via corner handles
  - Rotate with rotation handle
  - Double-click rotation handle to reset
- **Keyboard shortcuts**:
  - Ctrl/Cmd+C/V for copy/paste
  - Ctrl/Cmd+D to duplicate
  - Delete/Backspace to remove
  - Ctrl/Cmd+Z/Y for undo/redo
- **Navigation**:
  - Mouse wheel to zoom
  - Drag empty space to pan
- **Auto-save** to localStorage
- **High-DPI display** support

### Real-Time Collaboration
- **Multi-user editing** with live synchronization
- **User presence** indicators showing active collaborators
- **Conflict resolution** for simultaneous edits
- **Automatic reconnection** on network issues
- **Works offline** with seamless sync when reconnected

### Node Types
- **Images**: JPEG, PNG, WebP support with optimized rendering
- **Videos**: MP4, MOV support with collaborative playback controls
- **Text**: WYSIWYG editing with word wrapping and live updates

## Project Structure

```
ImageCanvas/
├── index.html              # Main application
├── js/
│   ├── app.js             # Application entry point
│   ├── canvas.js          # Core canvas implementation
│   ├── collaborative.js   # Real-time collaboration
│   ├── graph.js           # Node graph management
│   ├── nodes/             # Node type implementations
│   ├── core/              # Core systems (viewport, selection, etc.)
│   └── utils/             # Utilities and configuration
├── server/
│   ├── index.js           # Express + Socket.IO server
│   ├── src/
│   │   ├── database/      # SQLite database layer
│   │   └── realtime/      # WebSocket handlers
│   └── database/          # Database files
└── css/                   # Styles
```

## Technology Stack

- **Frontend**: Vanilla JavaScript with modular ES6 architecture
- **Backend**: Node.js + Express + Socket.IO
- **Database**: SQLite with WAL mode for performance
- **Real-time**: WebSocket communication with operational transformation
- **Media**: Canvas API with hardware acceleration

## Development

### Running in Development Mode
```bash
# Server with auto-reload
npm run dev

# Client server (in another terminal)
npm run serve-client
```

### Testing
Test files should be placed in:
- `.scratch/` - Temporary experiments
- `tests/integration/` - Integration tests  
- `tests/fixtures/` - Test HTML and data files

### Performance
- Sub-100ms operation latency
- 60fps canvas rendering
- Supports 10+ concurrent users
- Efficient image caching and rendering

## Browser Support
- Chrome, Firefox, Safari, Edge (latest versions)
- Requires ES6 support and localStorage

## License
[Your license here]
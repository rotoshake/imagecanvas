# Filesystem Access Research for ImageCanvas

## Overview

Research conducted on implementing filesystem operations for ImageCanvas, specifically for accessing shared storage and supporting design version management across different platforms.

## Browser-Based Limitations

In a pure browser environment (Chrome), there are significant restrictions:

1. **No Direct Network Access**: Browsers cannot directly access network shares (SMB/NFS) or UNC paths due to security sandboxing
2. **Limited Local Access**: The File System Access API only works with user-selected files/directories through picker dialogs
3. **No Background Monitoring**: Cannot watch directories for changes without user interaction

### Available Browser APIs

#### File System Access API (Modern, Chromium-based browsers)
- Requires user permission through file/directory pickers
- Methods: `window.showOpenFilePicker()`, `window.showDirectoryPicker()`
- Returns handles: `FileSystemFileHandle`, `FileSystemDirectoryHandle`
- Limited to local files, no network access

#### Origin Private File System (OPFS)
- Private storage endpoint for web apps
- Not user-visible in regular filesystem
- Good for app-specific storage, not external file access

#### File and Directory Entries API (Legacy)
- Wider browser support
- Read-only operations
- Works with drag-and-drop or file inputs

## Electron as a Solution

Moving to Electron would provide substantial benefits for the use case:

### Advantages:
1. **Full Node.js filesystem access** - Can read any directory, including network shares
2. **UNC path support** - Can access Windows network paths like `\\server\share\folder`
3. **Cross-platform compatibility** - Works on Windows, macOS, and Linux
4. **Directory watching** - Can monitor folders for new design versions in real-time
5. **Background operations** - Can scan for updates without user interaction

### Example Implementation in Electron:

```javascript
// Watch a network directory for new design versions
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

// Network path (properly escaped)
const designPath = '\\\\server\\designs\\project-x';

// Watch for changes
const watcher = chokidar.watch(designPath, {
  persistent: true,
  ignoreInitial: true
});

watcher.on('add', (filePath) => {
  // New design version detected
  console.log(`New design version: ${path.basename(filePath)}`);
});

// Reading files from UNC paths
const uncPath = '\\\\servername\\sharename\\folder\\file.txt';

fs.readFile(uncPath, 'utf8', (err, data) => {
    if (err) {
        console.error('Error reading file:', err);
        return;
    }
    console.log('File content:', data);
});
```

### Known Issues with Electron and Network Shares

1. **Freezing Issues**: Electron apps may freeze when run from network drives
2. **Permission Differences**: Network shares may have different filesystem permissions
3. **File Update Detection**: Events may be delayed on network filesystems
4. **Performance**: Network latency affects file operations

## Hybrid Approach Considerations

A hybrid approach could maintain browser compatibility while adding enhanced features:

1. **Keep web UI** - Main canvas remains browser-based
2. **Add server component** - Node.js backend handles filesystem operations
3. **WebSocket updates** - Real-time notifications of new versions
4. **Progressive enhancement** - Works in browser with manual uploads, enhanced features with Electron

## Design Version Management Features

With filesystem access, the following features could be implemented:

1. **Automatic version detection** - Scan directories for numbered versions (design_v1.png, design_v2.png)
2. **Version history timeline** - Show all available versions with timestamps
3. **Quick version switching** - Flip between designs with keyboard shortcuts
4. **Diff visualization** - Compare changes between versions
5. **Watch folders** - Auto-import new versions as they appear

## Performance Considerations

- **Network latency**: Cache thumbnails locally for quick previews
- **Large file handling**: Stream images rather than loading entirely
- **Concurrent access**: Handle file locks gracefully
- **Indexing**: Build local database of available versions

## Recommended Approach: Electron Migration

For accessing shared storage and managing design versions, Electron is strongly recommended because:

1. **Full filesystem access** - Can read from network shares (SMB/NFS) and UNC paths
2. **Directory watching** - Monitor folders for new design versions automatically
3. **No user friction** - Access files without constant permission dialogs
4. **Maintains web technologies** - Existing HTML/JS/CSS code works unchanged

## Implementation Plan

1. **Set up Electron wrapper** for ImageCanvas
2. **Create filesystem service** with:
   - Network share access (with proper UNC path handling)
   - Directory watching for new versions
   - Version detection algorithms
3. **Add version management UI**:
   - Version timeline/switcher
   - Keyboard shortcuts for flipping versions
   - Visual diff tools
4. **Implement caching layer** for network performance
5. **Add configuration** for watched directories

## Alternative Solutions

### Server-Side Proxy
- Create a backend service that accesses network storage
- Expose through web API
- Maintains browser compatibility
- Adds complexity and latency

### Browser Extensions
- Can have enhanced filesystem permissions
- Platform-specific development
- Distribution challenges

### Manual File Selection
- Users navigate to network drives through file picker
- Works if network drives are mounted locally
- Requires user interaction for each operation

## Conclusion

For a private network deployment with shared storage access and design version management, Electron provides the most comprehensive solution. It eliminates browser security restrictions while maintaining the ability to use existing web technologies. The main trade-off is losing pure browser deployment in exchange for powerful filesystem capabilities.
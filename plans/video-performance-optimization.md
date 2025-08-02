# Video Performance Optimization

## Problem
Multiple videos on the canvas were causing high CPU usage (85%+) because all videos continued playing and decoding frames even when offscreen.

## Solution Implemented

### 1. **Offscreen Video Pausing**
- Added visibility tracking to VideoNode with `_isVisible` property
- Videos automatically pause when they go offscreen
- Videos resume when they come back into view
- Preserves user pause state (won't auto-resume if user manually paused)

### 2. **Canvas Visibility System**
- Enhanced `updateNodeVisibility` to track visibility changes
- Notifies nodes via `onVisibilityChange` callback
- Efficient Set-based tracking of visible nodes

### 3. **Tiny Video Optimization**
- Videos pause when displayed smaller than 50 pixels
- Uses static thumbnail instead of live video when zoomed out
- Automatically resumes when zoomed in

### 4. **Resolution Switching (Prepared)**
- Added `getOptimalQuality` method for future multi-resolution support
- Quality levels: preview (240p), small (480p), medium (720p), full
- Ready for server-side implementation

## Changes Made

### js/nodes/video-node.js
- Added visibility and size tracking properties
- Implemented `onVisibilityChange` method
- Modified `managePlayback` to respect visibility
- Added tiny video pausing in `onDrawForeground`
- Prepared methods for multi-resolution support

### js/canvas.js
- Enhanced `updateNodeVisibility` to track and notify visibility changes
- Added Set-based tracking of previously visible nodes

### js/renderers/WebGLRenderer.js
- Fixed to support video nodes without hash properties (previous fix)

## Performance Impact
- Offscreen videos no longer consume CPU for decoding
- Tiny videos use thumbnails instead of live playback
- Expected CPU reduction from 85% to under 20% for typical usage

## Testing
Created test pages:
- `.scratch/test-video-performance.html` - Performance monitoring
- `.scratch/test-video-color-grading.html` - Color grading verification

## Future Enhancements
1. Server-side multi-resolution encoding (240p previews)
2. Dynamic quality switching based on zoom level
3. Limit maximum simultaneous playing videos
4. Use `requestVideoFrameCallback` for efficient rendering
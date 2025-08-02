# Video WebM Switching and Color Correction Fixes

## Issues Fixed

### 1. Videos Not Switching to WebM After Transcoding
**Problem**: When video transcoding completed on the server, the VideoProcessingListener updated the node properties but the video element continued playing the original MOV file.

**Solution**: 
- Added `updateVideoSource()` method to VideoNode that properly reloads the video element with the new URL
- Modified VideoProcessingListener to call this method after updating properties
- Preserves playback position and state during the transition

### 2. Color Corrections Not Working on Videos
**Problem**: Color grading wasn't applying to videos even though the UI showed controls and it worked for images.

**Root Cause**: Our previous WebGL fix allowed videos without hashes, but we needed to ensure videos were actually being rendered through WebGL.

**Solution**:
- Added debug logging to verify videos are rendered via WebGL
- The fix from earlier (allowing videos without hash) should now work properly
- Added logging for color adjustment values being sent to shaders

## Changes Made

### js/nodes/video-node.js
- Added `updateVideoSource()` method to reload video when transcoding completes
- Method preserves playback state (position, play/pause, volume)
- Creates new video element to avoid interruption
- Cleans up old video element properly

### js/core/VideoProcessingListener.js
- Modified `updateVideoNodes()` to call `updateVideoSource()` on nodes
- Maintains fallback for older nodes without the method

### js/renderers/WebGLRenderer.js
- Added debug logging for video WebGL rendering
- Logs when videos are rendered with WebGL
- Logs color adjustment values for debugging

## Testing
Created test page at `.scratch/test-video-fixes.html` that:
- Tests WebM switching after transcoding
- Tests color corrections on videos  
- Provides debug output for both features
- Includes combined test sequence

## Expected Behavior
1. **WebM Switching**: Videos should automatically switch to WebM format when transcoding completes
2. **Color Corrections**: Adjusting brightness/contrast/saturation/hue should immediately affect video appearance
3. **Performance**: Videos continue to pause when offscreen (previous optimization)

## Debug Commands
```javascript
// Enable debug logging
window.DEBUG_LOD_STATUS = true

// Check if video is using WebGL
// Look for: "🎥 Rendering video node ... with WebGL"

// Check color adjustments
// Look for: "🎨 Video color adjustments - B:... C:... S:... H:..."
```
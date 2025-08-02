# Video Format Detection and Color Correction Fix Update

## Issues Fixed

### 1. Property Inspector Still Showing "MOV (Original)"
**Problem**: Even after video switched to WebM, the property inspector continued showing the original format.

**Root Cause**: 
- The `updateVideoSource` method wasn't clearing `tempVideoUrl`, so `resolveVideoSource` kept returning the blob URL
- The property inspector checked for `tempVideoUrl` existence to determine if using original format

**Solution**:
- Modified `updateVideoSource` to clear `tempVideoUrl` before resolving new URL
- Added blob URL cleanup when switching to transcoded version
- Improved property inspector format detection logic to check actual video.src extension

### 2. Enhanced Format Detection in Property Inspector
**Improvements**:
- Now checks the actual video element's src URL extension
- Distinguishes between:
  - Blob URLs → "MOV (Original)"
  - Server URLs with transcoded format → "WEBM (Transcoded)"
  - Server URLs with original format → "MOV (Server)"
- Falls back to property-based detection when video element not available

## Changes Made

### js/nodes/video-node.js
```javascript
// In updateVideoSource method:
// Clear temp video URL to ensure we use the transcoded version
if (this.properties.tempVideoUrl) {
    console.log('🧹 Clearing tempVideoUrl to use transcoded version');
    delete this.properties.tempVideoUrl;
}

// Clean up blob URL if it was one
if (this._tempBlobUrl) {
    URL.revokeObjectURL(this._tempBlobUrl);
    delete this._tempBlobUrl;
}
```

### js/ui/floating-properties-inspector.js
- Improved currentFormat detection to check actual video.src extension
- Better handling of transcoded vs original format detection
- More accurate status display based on actual loaded video

## Color Corrections Status
- WebGL renderer already has debug logging for video color adjustments
- Color corrections should work once videos are properly rendering through WebGL
- Enable debug mode with `window.DEBUG_LOD_STATUS = true` to see:
  - "🎥 Rendering video node ... with WebGL"
  - "🎨 Video color adjustments - B:... C:... S:... H:..."

## Testing
Use the test page at `.scratch/test-video-fixes.html` to verify:
1. Videos switch to WebM after transcoding
2. Property inspector shows correct format
3. Color corrections apply to videos

## Expected Behavior
1. Upload video → Shows "MOV (Original)" with blob URL
2. Transcoding completes → Video switches to server URL
3. Property inspector updates → Shows "WEBM (Transcoded)"
4. Color corrections work on transcoded videos
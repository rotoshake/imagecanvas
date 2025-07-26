# Video Node Loading Ring and Flickering Fixes

## Issues Addressed

### 1. Loading Ring Behavior
- Video nodes now properly inherit loading ring implementation from BaseNode
- Loading rings maintain consistent 4px screen-space width at all zoom levels
- Progress tracking works correctly for video loading

### 2. Video Flickering on Page Reload
Fixed multiple causes of video flickering:
- Added `_primaryLoadCompleteTime` to track when video finishes loading
- Implemented `shouldShowLoadingRing()` method with cooldown period
- Improved video readiness checks before drawing

## Implementation Details

### Loading State Management
```javascript
// Prevent duplicate loading
this._loadingStarted = false; // Track if we've started loading
this.loadingState = 'idle'; // Start as idle, not loading

// In setVideo():
if (this._loadingStarted) {
    return; // Prevent multiple loading attempts
}
this._loadingStarted = true;
```

### Unified Loading Ring Check
```javascript
shouldShowLoadingRing() {
    // Always show during primary loading
    if (this.loadingState === 'loading' || (!this.video && this.loadingState !== 'error')) {
        return true;
    }
    
    // Don't show loading ring if primary loading just finished (prevents flicker)
    if (this._primaryLoadCompleteTime) {
        const timeSinceLoad = Date.now() - this._primaryLoadCompleteTime;
        if (timeSinceLoad < 300) { // 300ms cooldown
            return false;
        }
    }
    
    return false;
}
```

### Video Drawing Improvements
1. **Better readiness checks**: Video must have readyState >= 2 AND valid dimensions
2. **Fallback to thumbnail**: If video isn't ready but thumbnail exists, show thumbnail
3. **Graceful degradation**: Show loading placeholder if neither video nor thumbnail ready

### Key Changes in onDrawForeground
- Uses unified `shouldShowLoadingRing()` check instead of simple state check
- Checks video readiness before attempting to draw
- Falls back to thumbnail when video not ready
- Prevents blank frames during initialization

## Results
- Video nodes no longer flicker on page reload
- Loading rings behave consistently with image nodes
- Smooth transition from loading ring → thumbnail → full video
- No duplicate loading attempts when restoring from state
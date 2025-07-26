# Video Jittering Fix

## Problem
Videos were jittering forward and backward before settling into loop playback. This was caused by multiple competing mechanisms trying to restart the video.

## Root Causes
1. **Duplicate loop handling**: Both the 'ended' event listener and managePlayback() were trying to restart videos
2. **Thumbnail creation disruption**: Creating thumbnails was seeking to time 0, disrupting playback
3. **Redundant play() calls**: The play() method was being called even when video was already playing

## Solutions Implemented

### 1. Simplified Loop Handling
Removed manual restart in the 'ended' event listener:
```javascript
// Before:
video.addEventListener('ended', () => {
    if (video.loop) {
        video.currentTime = 0;
        video.play().catch(console.warn);
    }
});

// After:
video.addEventListener('ended', () => {
    // Trust the browser's loop implementation
    this.markDirty();
});
```

### 2. Non-Disruptive Thumbnail Creation
Changed thumbnail creation to use current frame instead of seeking:
```javascript
// Before: Sought to beginning, disrupting playback
video.currentTime = 0;

// After: Uses current frame
ctx.drawImage(this.video, 0, 0, thumbWidth, thumbHeight);
```

### 3. Conditional Play Calls
Added check to only call play() when video is actually paused:
```javascript
// In play() method:
if (this.video && this.video.paused) {  // Only play if actually paused
    this.video.play().catch(...);
}
```

### 4. Smarter Playback Management
Updated managePlayback() to handle edge cases better:
```javascript
// Only try to play if we should be playing but aren't
if (!this.properties.paused && this.video.paused && !this._needsUserInteraction) {
    // Check if video is at the end and needs manual restart
    if (this.video.ended && this.properties.loop) {
        this.video.currentTime = 0;
    }
    this.video.play().catch(...);
}
```

## Result
Videos now loop smoothly without jittering, as the browser's native loop functionality is properly utilized without interference from redundant restart attempts.
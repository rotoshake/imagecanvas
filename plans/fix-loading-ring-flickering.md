# Fix Loading Ring Flickering During Fast Loads

## Problem
Loading rings would flicker rapidly during fast image loads due to conflicting conditions that could trigger the loading ring display.

## Root Cause
There were **two separate conditions** that could show the loading ring:

1. **Primary loading condition** (line 491): `loadingState === 'loading' || (!this.img && loadingState !== 'error')`
2. **Thumbnail loading condition** (lines 523-536): When full image was loaded but thumbnails weren't ready

This created a race condition during fast loads:
- Image loads quickly → primary condition stops showing ring
- Thumbnails still generating → thumbnail condition immediately starts showing ring
- Thumbnails finish → ring disappears again
- This rapid on/off/on switching caused visible flickering

## Solution

### 1. Added Timing State
```javascript
this.primaryLoadCompleteTime = null; // Track when primary loading finished
```

### 2. Created Unified Loading Logic
Added `shouldShowLoadingRing()` method that consolidates all loading ring conditions:
- Shows during primary loading
- Adds 300ms cooldown after primary loading completes
- Shows for thumbnail generation only after cooldown period
- Prevents rapid state switching

### 3. Consolidated Draw Logic
- Replaced two separate loading ring conditions with single unified check
- Added faded image background during thumbnail loading phase
- Removed duplicate loading ring drawing code

## Code Changes

### Added to constructor:
```javascript
this.primaryLoadCompleteTime = null; // Track when primary loading finished to prevent flicker
```

### Added unified check method:
```javascript
shouldShowLoadingRing() {
    // Always show during primary loading
    if (this.loadingState === 'loading' || (!this.img && this.loadingState !== 'error')) {
        return true;
    }
    
    // Don't show thumbnail loading ring if primary loading just finished (prevents flicker)
    if (this.primaryLoadCompleteTime) {
        const timeSinceLoad = Date.now() - this.primaryLoadCompleteTime;
        if (timeSinceLoad < 300) { // 300ms cooldown
            return false;
        }
    }
    
    // Show for thumbnail generation only if we have an image and need thumbnails
    if (this.img && this.properties.hash && window.thumbnailCache && 
        !window.thumbnailCache.hasThumbnails(this.properties.hash)) {
        return true;
    }
    
    return false;
}
```

### Updated setImage method:
```javascript
this.primaryLoadCompleteTime = Date.now(); // Track completion time
```

### Replaced dual conditions with unified check:
```javascript
if (this.shouldShowLoadingRing()) {
    // Show faded image behind ring for thumbnail loading
    if (this.img && this.loadingState === 'loaded') {
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.drawImage(this.img, 0, 0, this.size[0], this.size[1]);
        ctx.restore();
    }
    this.drawProgressRing(ctx, this.loadingProgress);
    return;
}
```

## Result
- **Eliminated flickering** during fast image loads
- **Smooth transitions** between loading phases
- **Maintained functionality** - still shows loading progress for both image and thumbnail loading
- **Better UX** - faded image shows behind loading ring during thumbnail generation
# Texture Loading Performance Issues & Solutions

## Issue 1: Resolution Downgrade on Zoom
When zooming in, the image briefly shows a lower resolution thumbnail before jumping to full res when clicking on the node.

### Root Cause
The texture priority system doesn't maintain consistency across zoom levels. When zooming, existing high-res textures may be evicted due to memory pressure, and the system re-requests them at default priority instead of maintaining high priority for visible, zoomed-in content.

### Solution
1. **Track zoom-focused nodes**: When a node occupies >50% of viewport, mark it as "high zoom" and protect its textures
2. **Priority boost for large screen sizes**: Always use priority 0 (highest) when screen size indicates we need high resolution
3. **Prevent eviction during zoom**: Don't evict textures for nodes that are actively being zoomed in on

## Issue 2: Page Reload Performance
Initial page load is laggy even though only low-res thumbnails should be loading when zoomed out.

### Root Causes
1. **Decode bottleneck**: `maxConcurrentDecodes = 2` creates a bottleneck. With 100+ images, even 64px thumbnails take time to decode sequentially
2. **Upload budget too conservative**: Using only 1ms per frame means ~60 textures/second max upload rate
3. **Bulk loading detection threshold too high**: Only triggers at 10+ pending uploads, missing smaller batches
4. **No prioritization by visibility**: All visible nodes request textures simultaneously without considering what's actually on screen

### Solutions

#### A. Increase Decode Parallelism
- Increase `maxConcurrentDecodes` from 2 to 4-6 for initial load
- Use smaller value (2) only during interaction to maintain responsiveness

#### B. Adjust Upload Budget Dynamically
- Initial load: 8-16ms (half to full frame)
- Normal operation: 2-4ms 
- During interaction: 0.5ms (current)

#### C. Improve Bulk Loading Detection
- Lower threshold from 10 to 5 pending uploads
- Consider time since page load (first 2-3 seconds = bulk loading phase)

#### D. Implement Progressive Loading by Priority
- Load center-screen images first
- Load off-screen images with lower priority
- For zoomed-out view, only load 64px thumbnails initially

## Implementation

### Fix 1: Zoom Resolution Stability
```javascript
// In WebGLRenderer._requestTexture, boost priority for zoomed content
const viewportCoverage = (screenWidth * screenHeight) / (viewport.width * viewport.height);
if (viewportCoverage > 0.3) {
    // Node covers >30% of viewport - high priority
    priority = 0;
}

// In TextureLODManager, protect high-zoom textures
if (this._highZoomNodes.has(hash)) {
    // Skip eviction for high-zoom nodes
    continue;
}
```

### Fix 2: Reload Performance
```javascript
// In TextureLODManager constructor
this.pageLoadTime = Date.now();
this.isInitialLoad = true;
setTimeout(() => { this.isInitialLoad = false; }, 3000); // 3 second initial load period

// In processUploads
const isBulkLoading = this.uploadQueue.length > 5 || this.isInitialLoad;
const maxConcurrentDecodes = this.isInitialLoad ? 6 : 2;

// Adjust budget
if (this.isInitialLoad) {
    budgetMs = 8; // More aggressive during initial load
} else if (isBulkLoading) {
    budgetMs = 4;
} else if (this.canvas?.isInteracting) {
    budgetMs = 0.5;
} else {
    budgetMs = 2;
}
```

### Fix 3: Viewport-Based Priority
```javascript
// In WebGLRenderer._requestTexture
const viewportCenter = [viewport.width / 2, viewport.height / 2];
const nodeCenter = viewport.convertGraphToOffset(
    node.pos[0] + node.size[0]/2,
    node.pos[1] + node.size[1]/2
);
const distFromCenter = Math.sqrt(
    Math.pow(nodeCenter[0] - viewportCenter[0], 2) +
    Math.pow(nodeCenter[1] - viewportCenter[1], 2)
);

// Closer to center = higher priority
if (distFromCenter < viewport.width * 0.25) {
    priority = Math.max(0, priority - 1); // Boost priority for central nodes
}
```

## Expected Improvements
1. **Zoom stability**: No more resolution downgrades when zooming in
2. **Initial load**: 2-3x faster texture loading on page reload
3. **Smoother experience**: Progressive loading from center outward
4. **Better memory usage**: Smarter eviction based on viewport position
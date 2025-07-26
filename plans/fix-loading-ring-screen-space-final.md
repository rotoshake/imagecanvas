# Fix Loading Ring Screen Space Width - Final Solution

## Problem
The loading ring width wasn't maintaining consistent 4px screen space width at different zoom levels.

## Root Cause
The scale value wasn't always available through `this.graph?.canvas?.viewport?.scale`. During certain initialization states or when nodes are created before being fully attached to the graph, this path could be undefined, causing the scale to default to 1.

## Solution
Added fallback scale sources to ensure we always get the correct viewport scale:

```javascript
// Get scale for screen-space calculations with fallbacks
const scale = this.graph?.canvas?.viewport?.scale || 
             window.app?.graphCanvas?.viewport?.scale ||
             1;

// Screen-space consistent line width (4px on screen)
const lineWidth = 4 / scale;
```

## Key Points

1. **No redundant code found** - The loading ring is cleanly implemented only in base-node.js
2. **Correct formula** - Using `4 / scale` is correct because:
   - Canvas context is pre-scaled by `ctx.scale(viewport.scale, viewport.scale)`
   - To get 4px on screen, we need to compensate with `/scale`
   - This matches how selection borders and handles work in canvas.js
3. **Fallback chain** - Now tries multiple sources for scale:
   - Primary: `this.graph?.canvas?.viewport?.scale`
   - Fallback: `window.app?.graphCanvas?.viewport?.scale`
   - Default: `1` (no scaling)

## Result
The loading ring now maintains a consistent 4-pixel width on screen at all zoom levels, even during initialization or when nodes aren't fully attached to the graph yet.
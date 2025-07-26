# Fix Loading Ring Width - Remove Double Scale Compensation

## Problem
The loading ring width was not staying consistent at 4px screen space because of double scale compensation. The nodes were calculating `lineWidth = 4 / scale` but they draw within an already-scaled canvas context.

## Root Cause
1. Canvas applies `ctx.scale(this.viewport.scale, this.viewport.scale)` before drawing nodes
2. Node drawing happens within this transformed coordinate space
3. Nodes were still doing scale compensation: `lineWidth = 4 / scale`
4. This resulted in double compensation: 4px target ÷ scale × scale = varies based on timing/precision

## Solution
Changed the line width calculation to use a **fixed 4px width** since nodes draw in the already-transformed coordinate space:

```javascript
// Before (wrong):
const scale = this.graph?.canvas?.viewport?.scale || 1;
const lineWidth = 4 / scale;

// After (correct):
const lineWidth = 4; // 4px in transformed space = 4px on screen
```

## Files Updated
- **base-node.js**: Fixed drawProgressRing() line width calculation
- **image-node.js**: Fixed drawProgressRing() line width calculation  
- **video-node.js**: Inherits from base-node, so automatically fixed

## Why This Works
- Canvas context is pre-scaled by viewport.scale
- 4 pixels in the transformed coordinate space = 4 pixels on screen
- No manual scale compensation needed since the canvas transformation handles it

## Radius Limits Preserved
The radius limiting logic was kept intact:
- Still uses scale for min/max radius calculations (20px-100px screen space)
- Base radius still 15% of smallest node dimension
- These calculations are correct because they determine sizes within the transformed space

## Result
Loading rings now maintain a consistent 4-pixel width on screen at all zoom levels while the radius properly scales with the node size within reasonable bounds.
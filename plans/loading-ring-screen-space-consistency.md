# Loading Ring Screen-Space Consistency Update

## Summary
Updated the loading ring rendering to have consistent 4px width in screen space and added reasonable radius limits.

## Changes Made

### 1. Consistent Line Width
- Changed from varying widths (3px in base-node, 6px in image-node) to consistent 4px
- Line width calculation: `lineWidth = 4 / scale`
- This ensures the ring always appears as 4 pixels wide on screen regardless of zoom level

### 2. Radius Limits
Added screen-space limits to prevent rings from being too small or too large:
- **Minimum radius**: `20 / scale` (20px in screen space)
- **Maximum radius**: `100 / scale` (100px in screen space)
- **Base radius**: Still 15% of smallest node dimension

The final radius is calculated as:
```javascript
const baseRadius = Math.min(this.size[0], this.size[1]) * 0.15;
const minRadius = 20 / scale;
const maxRadius = 100 / scale;
const radius = Math.max(minRadius, Math.min(baseRadius, maxRadius));
```

### 3. Files Updated
- `/js/nodes/base-node.js` - Base implementation
- `/js/nodes/image-node.js` - Was overriding with different width, now consistent

## Visual Behavior

### At Different Zoom Levels:
- **Zoomed out (scale < 1)**: Ring width stays 4px on screen, radius limited to max 100px screen space
- **Normal zoom (scale = 1)**: Ring width is 4px, radius is 15% of node size (clamped between 20-100px)
- **Zoomed in (scale > 1)**: Ring width stays 4px on screen, radius limited to min 20px screen space

### For Different Node Sizes:
- **Small nodes**: Get minimum 20px radius ring (in screen space)
- **Medium nodes**: Use 15% of node size as radius
- **Large nodes**: Capped at 100px radius (in screen space)

## Testing
Created visual test at `/.scratch/test-loading-ring-visuals.html` to verify appearance at different zoom levels and node sizes.

## Result
The loading ring now maintains consistent visual weight across all zoom levels while keeping the radius proportional to the node size within reasonable bounds.
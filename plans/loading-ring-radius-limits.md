# Loading Ring Radius Limits for Small Nodes

## Problem
The loading ring could extend beyond the bounds of very small nodes because the minimum radius (20px screen space) didn't account for node size.

## Solution
Added proper constraints to ensure the loading ring always fits within its node:

### 1. Calculate Maximum Radius for Node
```javascript
// Ensure ring fits within node (leave space for line width)
const maxRadiusForNode = (nodeMinDimension / 2) - (lineWidth * 2); // Leave room for stroke
```

### 2. Apply Node Size Constraint
```javascript
// Apply all constraints: must fit in node, respect screen-space limits
const radius = Math.max(
    Math.min(baseRadius, maxRadiusForNode, maxRadius),
    Math.min(minRadius, maxRadiusForNode) // Don't exceed node bounds even for minimum
);
```

### 3. Skip Ring for Tiny Nodes
```javascript
// Don't draw ring if it would be too small or negative
if (radius <= lineWidth || maxRadiusForNode <= 0) {
    return; // Node too small for ring
}
```

## Behavior

### For Normal Nodes:
- Ring radius is 15% of smallest dimension
- Minimum 20px screen space
- Maximum 100px screen space
- Always fits within node bounds

### For Small Nodes:
- Ring shrinks to fit within node
- Leaves space for the 4px stroke width
- If node is too small to show a meaningful ring, nothing is drawn

### Edge Cases:
- Very small nodes (< ~12px): No ring drawn
- Small nodes: Ring fits exactly within bounds
- Large nodes: Ring capped at 100px screen space

## Result
The loading ring now gracefully handles nodes of all sizes, always staying within bounds and disappearing cleanly when nodes are too small to display a meaningful progress indicator.
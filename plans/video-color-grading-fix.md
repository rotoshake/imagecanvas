# Video Color Grading Fix

## Problem
Video color grading wasn't working even though the UI showed the controls and image color grading worked fine.

## Root Cause
The WebGLRenderer was rejecting video nodes because it required all nodes to have a `properties.hash` value. Video nodes don't always have a hash (especially when loaded from URLs or during initial loading), so they were falling back to Canvas2D rendering which doesn't support color grading.

## Solution
Modified the WebGLRenderer to handle video nodes differently:

1. **Conditional hash requirement**: Video nodes can now be rendered by WebGL if they have a valid video element (readyState >= 2), even without a hash
2. **Fallback node IDs**: For nodes without hashes, we generate IDs using the node type and position
3. **State tracking**: The render state cache now handles nodes without hashes properly

## Changes Made

### js/renderers/WebGLRenderer.js
- Modified the hash check to be conditional based on node type
- Video nodes only need a valid video element, not a hash
- Updated nodeId generation to handle missing hashes
- Fixed currentState object to use node type as fallback for hash

## Testing
Created a test page at `.scratch/test-video-color-grading.html` that:
- Creates video nodes without hashes
- Allows testing color adjustments
- Verifies WebGL rendering is active
- Shows debug output

## Result
Video nodes now render through WebGL when they have a valid video element, allowing color grading to work properly. The fix maintains backward compatibility with existing functionality while extending support to video nodes that don't have hash properties.
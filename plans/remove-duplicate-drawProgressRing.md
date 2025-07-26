# Remove Duplicate drawProgressRing from ImageNode

## Summary
Removed the unnecessary override of `drawProgressRing()` from `ImageNode` class since it was identical to the base implementation.

## Analysis
- **ImageNode** extends **BaseNode** 
- After fixing the line width calculation, both implementations became identical
- The only difference was commented-out percentage text code that wasn't being used
- No image-specific logic was needed in the progress ring drawing

## Change Made
- Removed the entire `drawProgressRing()` method from `/js/nodes/image-node.js`
- ImageNode now inherits the method from BaseNode automatically

## Benefits
- **Reduced code duplication**: One less method to maintain
- **Consistency**: All node types now use the same loading ring logic
- **Maintainability**: Changes to progress ring appearance only need to be made in BaseNode

## Node Types Coverage
- **BaseNode**: Has the definitive `drawProgressRing()` implementation
- **ImageNode**: Now inherits from BaseNode (was duplicate)
- **VideoNode**: Already inherited from BaseNode (no override)

## Result
All three node types now use the same consistent loading ring with:
- 4px screen-space width
- Radius scaling with proper limits (20px-100px screen space)
- Unified appearance across all media types
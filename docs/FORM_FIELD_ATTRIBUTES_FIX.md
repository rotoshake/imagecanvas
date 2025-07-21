# Form Field Attributes Fix

## Issue
The browser was showing warnings about form fields lacking id and name attributes, which could prevent proper autofill functionality.

## Solution
Added appropriate id and name attributes to all dynamically created form elements across the codebase.

### Files Modified

1. **js/ui/canvas-navigator.js**
   - Added `name="canvas-title"` and `id="canvas-title-${canvas.id}"` to canvas title input fields

2. **js/ui/floating-properties-inspector.js**
   - Text inputs: `name="property-${prop}"` and `id="property-input-${prop}"`
   - Number inputs: `name="property-${prop}"` and `id="property-input-${prop}"`
   - Color inputs: `name="property-${prop}"` and `id="property-input-${prop}"`
   - Range inputs: `name="property-${prop}"` and `id="property-input-${prop}"`
   - Select dropdowns: `name="property-${prop}"` and `id="property-select-${prop}"`
   - Checkboxes: `name="property-${prop}"` and `id="property-checkbox-${prop}"`

3. **js/canvas.js**
   - Added `name="text-edit-${node.id}"` and `id="text-edit-${node.id}"` to text editing textarea

## Testing
Created a test page at `.scratch/test-form-fields.html` that monitors all form elements and verifies they have proper attributes.

## Benefits
- Eliminates browser console warnings
- Enables proper autofill functionality
- Improves form accessibility
- Better form field identification for automated testing
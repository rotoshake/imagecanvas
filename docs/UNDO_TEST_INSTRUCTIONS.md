# Undo System Test Instructions

## Quick Test in Browser Console

1. Open http://localhost:8000 in your browser
2. Open the browser console (F12 or Cmd+Option+I)
3. Copy and paste the diagnostic script:

```javascript
// Quick check
console.log('🔍 Checking undo system...');
if (app && app.undoRedoManager) {
    const info = app.undoRedoManager.getHistoryInfo();
    console.log('✅ Undo system ready');
    console.log(`History: ${info.size} operations, Can undo: ${info.canUndo}`);
} else {
    console.log('❌ Undo system not found');
}
```

## Automated Test Suite

Copy the entire contents of `.scratch/test-undo-browser.js` into the console. It will:
1. Test create operations
2. Test move operations  
3. Test rotation operations
4. Test operation bundling
5. Show results for each test

## Manual Tests

### Test 1: Move Operation
1. Create any node (text, image, etc.)
2. Drag it to a new position
3. **Immediately** press Ctrl+Z (or Cmd+Z on Mac)
4. ✅ Node should return to original position without delay

### Test 2: Rotation
1. Create a node
2. Rotate it using the rotation handle
3. **Immediately** press Ctrl+Z
4. ✅ Node should return to original angle without delay

### Test 3: Alt+Drag Duplication
1. Hold Alt and drag a node to duplicate it
2. **Immediately** press Ctrl+Z
3. ✅ The duplicate should disappear (single undo for both create + move)

### Test 4: Multiple Operations
1. Create a node
2. Move it several times quickly
3. Press Ctrl+Z once
4. ✅ If moves were within 100ms, they should all undo together

## What to Look For

### ✅ Success Indicators:
- Undo works immediately (no 2-3 second delay)
- Console shows "Capturing command immediately" messages
- Alt+drag creates one undo entry, not two
- Multiple quick operations bundle into one undo

### ❌ Failure Indicators:
- Have to wait before Ctrl+Z works
- Console shows "Not capturing" messages
- Alt+drag requires two undos
- Each operation creates separate undo entry

## Console Logging

To see detailed logs of what's happening:
1. Look for messages starting with 🎯
2. Key messages:
   - `🎯 Interceptors set up` - System initialized
   - `🎯 applyOptimistic interceptor` - Operation captured
   - `✅ Capturing command immediately` - Added to undo history
   - `⏭️ Not capturing` - Operation skipped (with reason)

## Troubleshooting

If undo isn't working immediately:

1. **Check if interceptors are set up:**
```javascript
app.stateSyncManager.applyOptimistic.toString().includes('interceptor')
```

2. **Check optimistic mode:**
```javascript
console.log('Optimistic:', app.stateSyncManager.optimisticEnabled);
```

3. **Force setup interceptors:**
```javascript
app.undoRedoManager.setupInterceptors();
```

4. **Check history manually:**
```javascript
console.log(app.undoRedoManager.getHistoryInfo());
```
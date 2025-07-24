# Bulk Undo Test Instructions

## Manual Test Steps

### Prerequisites
1. Open the ImageCanvas application in your browser (http://localhost:8000)
2. Open the browser console (F12)
3. Ensure the application is loaded (check for `app.undoRedoManager`)

### Test 1: Verify Setup
Run in console:
```javascript
// Check components
console.log('Undo Manager:', app.undoRedoManager?.constructor.name);
console.log('BulkCommand loaded:', typeof BulkCommand);
console.log('Interceptors setup:', app.undoRedoManager?.interceptorsSetUp);
```

Expected output:
- Undo Manager: CollaborativeUndoRedoManager
- BulkCommand loaded: function
- Interceptors setup: true

### Test 2: Simple Undo Test (5 nodes)
Run in console:
```javascript
// Clear and create 5 nodes
app.graph.clear();
for (let i = 0; i < 5; i++) {
    await app.operationPipeline.execute('node_create', {
        type: 'media/image',
        pos: [100 + i * 100, 200],
        size: [80, 80]
    });
}
console.log('Created 5 nodes');
console.log('Can undo:', app.undoRedoManager.canUndo());
```

Then press Ctrl+Z (or Cmd+Z on Mac) 5 times. All nodes should disappear.

### Test 3: Bulk Operation Test (100 nodes)

#### Option A: Copy-Paste Test
1. Create one image node manually (drag an image to canvas)
2. Select it (click on it)
3. Copy it (Ctrl+C)
4. Run this in console to paste 100 times:
```javascript
// Paste 100 nodes
const pasteData = [];
for (let i = 0; i < 100; i++) {
    pasteData.push({
        type: 'media/image',
        pos: [100 + (i % 10) * 60, 100 + Math.floor(i / 10) * 60],
        size: [50, 50],
        properties: { 
            src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' 
        }
    });
}

// Execute bulk paste
await app.bulkOperationManager.executeBulkOperation(
    'node_paste',
    pasteData,
    { targetPosition: [500, 500] },
    (data) => data
);
```

5. Check node count:
```javascript
console.log('Total nodes:', app.graph.nodes.length);
```

6. Press Ctrl+Z once
7. Check node count again - all 100 nodes should be removed

#### Option B: Alt+Drag Test
1. Create 100 nodes first:
```javascript
app.graph.clear();
for (let i = 0; i < 100; i++) {
    const node = NodeFactory.createNode('media/image');
    node.pos = [100 + (i % 10) * 60, 100 + Math.floor(i / 10) * 60];
    node.size = [50, 50];
    app.graph.add(node);
}
```

2. Select all (Ctrl+A)
3. Alt+drag to duplicate all 100 nodes
4. Press Ctrl+Z once - all 100 duplicates should be removed

### Test 4: Move Operation Test
1. Create 100 nodes (use code from Option B above)
2. Select all (Ctrl+A)
3. Drag to move all nodes
4. Press Ctrl+Z - all nodes should return to original positions

### Debugging

If undo only affects some nodes, check:
```javascript
// Check last history entry
const history = app.undoRedoManager.currentUserHistory || [];
const lastEntry = history[history.length - 1];
console.log('Last entry type:', lastEntry?.type);
console.log('Last entry details:', lastEntry);

// For BulkCommand, check chunks
if (lastEntry?.type?.startsWith('bulk_')) {
    console.log('Chunk count:', lastEntry.chunks?.length);
    console.log('Total items:', lastEntry.chunks?.reduce((sum, c) => sum + c.items.length, 0));
}
```

### Expected Results
- ✅ Single Ctrl+Z should undo ALL nodes in a bulk operation
- ✅ History should show one entry for bulk operations, not multiple
- ✅ BulkCommand should wrap multi-chunk operations

### Known Issues to Watch For
1. If using CollaborativeUndoRedoManager, check bundling window (100ms default)
2. Ensure BulkCommand is loaded before BulkOperationManager
3. Verify interceptors are set up before operations
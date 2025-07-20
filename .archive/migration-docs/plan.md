# Unified Development Plan for ImageCanvas Collaboration

## Consensus from All Opinions

All three opinions agree on these critical points:
1. **The architecture is correct** - Client → Server → Clients via WebSockets is industry standard (Figma uses this)
2. **The implementation is incomplete** - 70% done with critical missing pieces
3. **Multiple parallel systems cause chaos** - UnifiedOperationHandler vs CanvasActionManager vs direct broadcasts
4. **Missing operation handlers** - Many operations broadcast but aren't handled on receiving end
5. **Multi-tab should "just work"** - It's a basic requirement that the current system can support

## Unified Approach for Development

### Core Principle: Complete, Don't Rebuild
Based on all opinions, the best path forward is to **complete the existing implementation** rather than starting over. The sophisticated components (UnifiedOperationHandler, TransactionManager) represent good engineering - they just need to be properly connected.

### Phase 1: Unify Operation Handling (Day 1-2)
**Goal**: Single source of truth for all operations

1. **Wire UnifiedOperationHandler into CollaborativeManager**
   ```javascript
   // In CollaborativeManager constructor
   this.operationHandler = new UnifiedOperationHandler(this.graph, this);
   this.transactionManager = new TransactionManager(this.operationHandler);
   ```

2. **Route ALL operations through UnifiedOperationHandler**
   - Remove all direct `broadcastNode*()` calls
   - Replace with `operationHandler.execute(type, data)`
   - Ensure every user action goes through this single path

3. **Complete missing operation handlers**
   - `node_reset` → `applyNodeReset()`
   - `video_toggle` → `applyVideoToggle()`
   - `layer_order_change` → `applyLayerOrderChange()`
   - `text_update` → `applyTextUpdate()`

### Phase 2: Fix Critical Bugs (Day 2-3)
**Goal**: Make existing operations work correctly

1. **Fix node creation to use NodeFactory**
   ```javascript
   applyNodeCreate(data) {
       const node = NodeFactory.createNode(data.nodeData.type, {
           ...data.nodeData,
           pos: [...data.nodeData.pos],
           size: [...data.nodeData.size]
       });
       if (node) {
           this.graph.add(node);
       }
   }
   ```

2. **Standardize operation data formats**
   - All move operations use `{nodeIds: [], positions: []}`
   - All property updates use `{nodeId, properties: {}}`
   - Document the format for each operation type

3. **Implement proper deduplication**
   - Track operations by unique ID, not just socket ID
   - Handle multiple tabs from same user correctly

### Phase 3: Add Robustness (Day 3-4)
**Goal**: Make collaboration reliable

1. **Add operation validation**
   - Verify node exists before applying operations
   - Check data format before processing
   - Log but don't crash on invalid operations

2. **Implement state reconciliation**
   - Periodic sync check every 30 seconds
   - Full state recovery on reconnection
   - Handle out-of-order operations gracefully

3. **Add error recovery**
   - Retry failed operations with exponential backoff
   - Clear error messages in UI
   - Graceful degradation to local-only mode

## Comprehensive CLI Testing Method

### Test Suite Structure
```bash
# Create test structure
mkdir -p tests/collaboration
cd tests/collaboration
```

### 1. Multi-Tab Test Script
```javascript
// tests/collaboration/multi-tab-test.js
const puppeteer = require('puppeteer');

async function testMultiTabCollaboration() {
    const browser = await puppeteer.launch({ headless: false });
    
    // Launch two tabs
    const tab1 = await browser.newPage();
    const tab2 = await browser.newPage();
    
    // Navigate both to the app
    await tab1.goto('http://localhost:8000');
    await tab2.goto('http://localhost:8000');
    
    // Wait for connection
    await tab1.waitForSelector('.status-indicator.status-success', { timeout: 5000 });
    await tab2.waitForSelector('.status-indicator.status-success', { timeout: 5000 });
    
    // Tab 1: Create a node
    await tab1.evaluate(() => {
        const node = NodeFactory.createNode('canvas/image', {
            pos: [100, 100],
            size: [200, 200],
            properties: { src: 'test.jpg' }
        });
        window.graph.add(node);
    });
    
    // Wait for sync
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Tab 2: Verify node exists
    const nodeExists = await tab2.evaluate(() => {
        const nodes = window.graph._nodes;
        return nodes.some(n => n.pos[0] === 100 && n.pos[1] === 100);
    });
    
    console.log('Node sync test:', nodeExists ? 'PASSED' : 'FAILED');
    
    // Continue with more operations...
    return { success: nodeExists };
}

// Run the test
testMultiTabCollaboration();
```

### 2. Operation Coverage Test
```javascript
// tests/collaboration/operation-coverage.js
const operations = [
    'node_create',
    'node_move',
    'node_resize',
    'node_rotate',
    'node_delete',
    'node_update',
    'node_property_update',
    'node_reset',
    'video_toggle',
    'layer_order_change',
    'text_update'
];

async function testOperationCoverage() {
    const results = {};
    
    for (const op of operations) {
        // Test if operation broadcasts
        const broadcasts = await testBroadcast(op);
        
        // Test if operation has handler
        const hasHandler = await testHandler(op);
        
        // Test if operation applies correctly
        const appliesCorrectly = await testApplication(op);
        
        results[op] = {
            broadcasts,
            hasHandler,
            appliesCorrectly,
            status: broadcasts && hasHandler && appliesCorrectly ? 'PASS' : 'FAIL'
        };
    }
    
    // Generate report
    console.table(results);
    return results;
}
```

### 3. Stress Test Script
```javascript
// tests/collaboration/stress-test.js
async function stressTest() {
    const browser = await puppeteer.launch({ headless: false });
    const tabs = [];
    
    // Create 5 tabs
    for (let i = 0; i < 5; i++) {
        const tab = await browser.newPage();
        await tab.goto('http://localhost:8000');
        tabs.push(tab);
    }
    
    // Rapid operations from all tabs
    const promises = tabs.map((tab, index) => {
        return tab.evaluate((tabIndex) => {
            const operations = [];
            
            // Create 10 nodes rapidly
            for (let i = 0; i < 10; i++) {
                setTimeout(() => {
                    const node = NodeFactory.createNode('canvas/text', {
                        pos: [tabIndex * 100 + i * 10, tabIndex * 100],
                        properties: { text: `Tab ${tabIndex} Node ${i}` }
                    });
                    window.graph.add(node);
                }, i * 100);
            }
        }, index);
    });
    
    await Promise.all(promises);
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Verify all tabs have same state
    const states = await Promise.all(tabs.map(tab => 
        tab.evaluate(() => ({
            nodeCount: window.graph._nodes.length,
            nodes: window.graph._nodes.map(n => n.id).sort()
        }))
    ));
    
    // Check consistency
    const consistent = states.every(state => 
        state.nodeCount === states[0].nodeCount &&
        JSON.stringify(state.nodes) === JSON.stringify(states[0].nodes)
    );
    
    console.log('Stress test:', consistent ? 'PASSED' : 'FAILED');
    console.log('Node counts:', states.map(s => s.nodeCount));
}
```

### 4. Test Runner
```bash
#!/bin/bash
# tests/collaboration/run-tests.sh

echo "🧪 ImageCanvas Collaboration Test Suite"
echo "======================================"

# Start server
echo "Starting server..."
cd ../../server && npm start &
SERVER_PID=$!
sleep 3

# Start client
echo "Starting client..."
cd ../
python3 -m http.server 8000 &
CLIENT_PID=$!
sleep 2

# Run tests
echo -e "\n📋 Running Multi-Tab Test..."
node tests/collaboration/multi-tab-test.js

echo -e "\n📋 Running Operation Coverage Test..."
node tests/collaboration/operation-coverage.js

echo -e "\n📋 Running Stress Test..."
node tests/collaboration/stress-test.js

# Cleanup
kill $SERVER_PID $CLIENT_PID

echo -e "\n✅ Test suite complete!"
```

## List of Next Steps

### Immediate (This Week)
1. [ ] **Fix node creation** - Use NodeFactory in applyNodeCreate()
2. [ ] **Add missing handlers** - video_toggle, layer_order_change, node_reset
3. [ ] **Wire UnifiedOperationHandler** - Connect it to CollaborativeManager
4. [ ] **Run multi-tab test** - Verify basic sync works
5. [ ] **Fix operation formats** - Standardize all operation data structures

### Short Term (Next Week)
6. [ ] **Complete operation coverage** - Ensure ALL operations sync
7. [ ] **Add deduplication** - Prevent duplicate operation application
8. [ ] **Implement state reconciliation** - Periodic sync checks
9. [ ] **Create debug overlay** - Visual operation flow debugging
10. [ ] **Run stress tests** - Verify system handles rapid operations

### Medium Term (Week 3)
11. [ ] **Add operation validation** - Verify operations before applying
12. [ ] **Implement conflict resolution** - Handle simultaneous edits
13. [ ] **Add presence indicators** - Show other users' cursors/selections
14. [ ] **Create operation history** - For debugging and undo/redo
15. [ ] **Performance optimization** - Batch operations, reduce bandwidth

### Long Term (Month 2)
16. [ ] **Add permissions system** - Read-only viewers, edit permissions
17. [ ] **Implement offline mode** - Queue operations when disconnected
18. [ ] **Add compression** - Reduce operation payload sizes
19. [ ] **Create admin dashboard** - Monitor active sessions, performance
20. [ ] **Deploy to production** - Set up proper infrastructure

## Success Metrics

1. **Multi-tab test passes** - Same user, multiple tabs sync perfectly
2. **All operations sync** - 100% operation coverage in tests
3. **<100ms sync time** - Operations appear instantly on other clients
4. **No lost operations** - Stress test shows 100% consistency
5. **Graceful degradation** - Works offline, syncs when reconnected

## Final Note

The consensus is clear: **your architecture is correct, your implementation is incomplete**. Focus on completing what you've built rather than starting over. The sophisticated components you've created (UnifiedOperationHandler, TransactionManager) are good engineering - they just need to be properly connected. With 3-4 days of focused work following this plan, you'll have Figma-level collaboration.
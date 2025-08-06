// Test collaborative features directly
window.testCollab = function() {
    console.log('=== Testing Collaborative Features ===');
    
    // Test 1: Check if we can manually trigger a selection broadcast
    if (window.app?.otherUsersSelectionManager) {
        console.log('Test 1: Manually broadcasting selection...');
        const testSelection = new Map();
        testSelection.set('test-node-1', true);
        window.app.otherUsersSelectionManager.broadcastSelectionChange(testSelection);
    }
    
    // Test 2: Check if we can receive events
    if (window.app?.networkLayer) {
        console.log('\nTest 2: Checking event listeners...');
        const handlers = window.app.networkLayer.eventHandlers;
        console.log('Event handlers registered:', Array.from(handlers.keys()));
    }
    
    // Test 3: Check socket connection
    if (window.app?.networkLayer?.socket) {
        console.log('\nTest 3: Socket state...');
        console.log('Socket connected:', window.app.networkLayer.socket.connected);
        console.log('Socket ID:', window.app.networkLayer.socket.id);
        
        // Check if socket has event listeners
        const events = window.app.networkLayer.socket._callbacks || {};
        console.log('Socket event listeners:', Object.keys(events));
    }
    
    // Test 4: Try to emit directly
    if (window.app?.networkLayer?.socket) {
        console.log('\nTest 4: Direct emit test...');
        window.app.networkLayer.emit('test_event', { test: 'data' });
    }
    
    console.log('=== End Test ===');
};

// Also add a function to monitor incoming events
window.monitorCollab = function() {
    if (!window.app?.networkLayer) {
        console.log('NetworkLayer not available');
        return;
    }
    
    console.log('Monitoring collaborative events...');
    
    // Monitor selection updates
    window.app.networkLayer.on('user_selection_update', (data) => {
        console.log('📥 MONITOR: Received user_selection_update:', data);
    });
    
    // Monitor mouse updates
    window.app.networkLayer.on('user_mouse_update', (data) => {
        console.log('📥 MONITOR: Received user_mouse_update:', data);
    });
    
    // Monitor viewport updates
    window.app.networkLayer.on('user_viewport_update', (data) => {
        console.log('📥 MONITOR: Received user_viewport_update:', data);
    });
    
    console.log('Monitoring started. Events will be logged as they arrive.');
};

console.log('Test helpers loaded. Run testCollab() to test, monitorCollab() to monitor events.');
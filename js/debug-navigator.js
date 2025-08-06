// Debug the navigator user display issue
window.debugNavigator = function() {
    console.log('=== Navigator Debug ===');
    
    const navigator = window.app?.canvasNavigator;
    if (!navigator) {
        console.log('No canvas navigator found');
        return;
    }
    
    console.log('Current canvas ID:', navigator.currentCanvasId);
    console.log('Active users per canvas:', navigator.activeUsersPerCanvas);
    
    // Check current canvas users
    if (navigator.currentCanvasId) {
        const users = navigator.activeUsersPerCanvas.get(navigator.currentCanvasId);
        console.log(`Users on canvas ${navigator.currentCanvasId}:`, users);
    }
    
    // Force a re-render
    console.log('Forcing canvas list re-render...');
    navigator.renderCanvasList();
};

// Also check the structure of active users
window.checkUserStructure = function() {
    const navigator = window.app?.canvasNavigator;
    if (!navigator || !navigator.currentCanvasId) {
        console.log('No navigator or current canvas');
        return;
    }
    
    const users = navigator.activeUsersPerCanvas.get(navigator.currentCanvasId) || [];
    console.log('=== User Structure Debug ===');
    users.forEach((user, index) => {
        console.log(`User ${index}:`, {
            userId: user.userId,
            username: user.username,
            displayName: user.displayName,
            color: user.color,
            allKeys: Object.keys(user)
        });
    });
    
    console.log('\nCurrent user from app:', window.app.currentUser);
    console.log('Current user ID type:', typeof window.app.currentUser?.id);
    
    if (users.length > 0) {
        console.log('First user ID type:', typeof users[0].userId);
    }
};

console.log('Navigator debug loaded. Run debugNavigator() or checkUserStructure()');
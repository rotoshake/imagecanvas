// Debug helper for collaborative features
window.debugCollab = function() {
    console.log('=== Collaborative Features Debug ===');
    
    // Check app state
    console.log('App exists:', !!window.app);
    console.log('Current user:', window.app?.currentUser);
    console.log('User profile system user:', window.app?.userProfileSystem?.currentUser);
    console.log('User profile system info:', window.app?.userProfileSystem?.getUserInfo());
    
    // Check network state
    console.log('\nNetwork Layer:');
    console.log('Network layer exists:', !!window.app?.networkLayer);
    console.log('Is connected:', window.app?.networkLayer?.isConnected);
    console.log('Is joined:', window.app?.networkLayer?.isJoined);
    console.log('Current canvas:', window.app?.networkLayer?.currentCanvas);
    console.log('Network current user:', window.app?.networkLayer?.currentUser);
    
    // Check collaborative managers
    console.log('\nCollaborative Managers:');
    console.log('Selection manager exists:', !!window.app?.otherUsersSelectionManager);
    console.log('Mouse manager exists:', !!window.app?.otherUsersMouseManager);
    console.log('Follow manager exists:', !!window.app?.userFollowManager);
    
    // Check selection state
    console.log('\nSelection State:');
    if (window.app?.otherUsersSelectionManager) {
        console.log('Other users selections:', window.app.otherUsersSelectionManager.otherUsersSelections);
    }
    
    // Check mouse state
    console.log('\nMouse State:');
    if (window.app?.otherUsersMouseManager) {
        console.log('Other users mice:', window.app.otherUsersMouseManager.otherUsersMice);
    }
    
    console.log('=== End Debug ===');
};

console.log('Debug helper loaded. Run debugCollab() to see collaborative features state.');
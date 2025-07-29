// ===================================
// USER PROFILE SYSTEM
// ===================================

/**
 * UserProfileSystem - Manages user authentication, profiles, and preferences
 * Provides a foundation for user-specific features and collaboration
 */
class UserProfileSystem {
    constructor() {
        this.currentUser = null;
        this.isAuthenticated = false;
        this.preferences = {};
        this.profile = {};
        
        // Event listeners for profile changes
        this.listeners = new Set();
        
        // Initialize with stored data
        this.loadStoredProfile();
        
        console.log('👤 UserProfileSystem initialized');
    }
    
    /**
     * Initialize user profile system
     */
    async init() {
        // Load stored preferences
        await this.loadPreferences();
        
        // Check for existing session
        await this.checkExistingSession();
        
        // Set up auto-save for preferences
        this.setupAutoSave();
        
        console.log('✅ UserProfileSystem ready');
    }
    
    /**
     * Check for existing user session
     */
    async checkExistingSession() {
        const storedUser = localStorage.getItem('imagecanvas_user');
        if (storedUser) {
            try {
                const userData = JSON.parse(storedUser);
                await this.setCurrentUser(userData);
                console.log('🔐 Restored user session:', userData.username);
            } catch (error) {
                console.warn('Failed to restore user session:', error);
                localStorage.removeItem('imagecanvas_user');
            }
        }
    }
    
    /**
     * Set current user
     */
    async setCurrentUser(userData) {
        this.currentUser = {
            id: userData.id || this.generateUserId(),
            username: userData.username || 'Anonymous',
            email: userData.email || null,
            avatar: userData.avatar || null,
            createdAt: userData.createdAt || new Date().toISOString(),
            lastSeen: new Date().toISOString()
        };
        
        this.isAuthenticated = !!userData.id;
        
        // Store in localStorage
        localStorage.setItem('imagecanvas_user', JSON.stringify(this.currentUser));
        
        // Notify listeners
        this.notifyListeners('userChanged', this.currentUser);
        
        console.log('👤 User set:', this.currentUser.username);
    }
    
    /**
     * Create anonymous user
     */
    async createAnonymousUser() {
        const userData = {
            username: `User_${Math.random().toString(36).substr(2, 6)}`,
            createdAt: new Date().toISOString()
        };
        
        await this.setCurrentUser(userData);
        return this.currentUser;
    }
    
    /**
     * Login with credentials
     */
    async login(credentials) {
        try {
            // For now, simulate server authentication
            // In production, this would make an API call
            const response = await this.authenticateWithServer(credentials);
            
            if (response.success) {
                await this.setCurrentUser(response.user);
                return { success: true, user: this.currentUser };
            } else {
                return { success: false, error: response.error };
            }
        } catch (error) {
            console.error('Login failed:', error);
            return { success: false, error: 'Login failed' };
        }
    }
    
    /**
     * Simulate server authentication
     */
    async authenticateWithServer(credentials) {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // For demo purposes, accept any credentials
        // In production, this would validate against a real server
        return {
            success: true,
            user: {
                id: `user_${Date.now()}`,
                username: credentials.username,
                email: credentials.email,
                createdAt: new Date().toISOString()
            }
        };
    }
    
    /**
     * Logout current user
     */
    logout() {
        this.currentUser = null;
        this.isAuthenticated = false;
        
        // Clear stored data
        localStorage.removeItem('imagecanvas_user');
        
        // Notify listeners
        this.notifyListeners('userChanged', null);
        
        console.log('👋 User logged out');
    }
    
    /**
     * Update user profile
     */
    async updateProfile(updates) {
        if (!this.currentUser) {
            throw new Error('No user logged in');
        }
        
        Object.assign(this.currentUser, updates);
        this.currentUser.lastSeen = new Date().toISOString();
        
        // Store updated profile
        localStorage.setItem('imagecanvas_user', JSON.stringify(this.currentUser));
        
        // Notify listeners
        this.notifyListeners('profileUpdated', this.currentUser);
        
        console.log('📝 Profile updated');
    }
    
    /**
     * Get user preference
     */
    getPreference(key, defaultValue = null) {
        return this.preferences[key] !== undefined ? this.preferences[key] : defaultValue;
    }
    
    /**
     * Set user preference
     */
    setPreference(key, value) {
        this.preferences[key] = value;
        this.savePreferences();
        
        // Notify listeners
        this.notifyListeners('preferenceChanged', { key, value });
    }
    
    /**
     * Load preferences from storage
     */
    async loadPreferences() {
        try {
            const stored = localStorage.getItem('imagecanvas_preferences');
            if (stored) {
                this.preferences = JSON.parse(stored);
            }
        } catch (error) {
            console.warn('Failed to load preferences:', error);
            this.preferences = {};
        }
    }
    
    /**
     * Save preferences to storage
     */
    savePreferences() {
        try {
            localStorage.setItem('imagecanvas_preferences', JSON.stringify(this.preferences));
        } catch (error) {
            console.warn('Failed to save preferences:', error);
        }
    }
    
    /**
     * Setup auto-save for preferences
     */
    setupAutoSave() {
        // Auto-save preferences every 30 seconds if changed
        setInterval(() => {
            if (this.preferencesChanged) {
                this.savePreferences();
                this.preferencesChanged = false;
            }
        }, 30000);
    }
    
    /**
     * Load stored profile data
     */
    loadStoredProfile() {
        try {
            const stored = localStorage.getItem('imagecanvas_profile');
            if (stored) {
                this.profile = JSON.parse(stored);
            }
        } catch (error) {
            console.warn('Failed to load profile:', error);
            this.profile = {};
        }
    }
    
    /**
     * Save profile data
     */
    saveProfile() {
        try {
            localStorage.setItem('imagecanvas_profile', JSON.stringify(this.profile));
        } catch (error) {
            console.warn('Failed to save profile:', error);
        }
    }
    
    /**
     * Generate unique user ID
     */
    generateUserId() {
        return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Add event listener
     */
    addListener(event, callback) {
        this.listeners.add({ event, callback });
    }
    
    /**
     * Remove event listener
     */
    removeListener(event, callback) {
        for (const listener of this.listeners) {
            if (listener.event === event && listener.callback === callback) {
                this.listeners.delete(listener);
                break;
            }
        }
    }
    
    /**
     * Notify all listeners
     */
    notifyListeners(event, data) {
        for (const listener of this.listeners) {
            if (listener.event === event) {
                try {
                    listener.callback(data);
                } catch (error) {
                    console.warn('Listener error:', error);
                }
            }
        }
    }
    
    /**
     * Get user display name
     */
    getDisplayName() {
        if (!this.currentUser) return 'Guest';
        return this.currentUser.username || 'Anonymous';
    }
    
    /**
     * Get user avatar
     */
    getAvatar() {
        if (!this.currentUser) return null;
        return this.currentUser.avatar;
    }
    
    /**
     * Check if user is authenticated
     */
    isUserAuthenticated() {
        return this.isAuthenticated && this.currentUser;
    }
    
    /**
     * Get user info for collaboration
     */
    getUserInfo() {
        if (!this.currentUser) return null;
        
        return {
            id: this.currentUser.id,
            username: this.currentUser.username,
            avatar: this.currentUser.avatar,
            color: this.getUserColor()
        };
    }
    
    /**
     * Get user color for collaboration
     */
    getUserColor() {
        if (!this.currentUser) return '#666666';
        
        // Generate consistent color based on user ID
        const colors = [
            '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57',
            '#ff9ff3', '#54a0ff', '#5f27cd', '#00d2d3', '#ff9f43'
        ];
        
        const index = this.currentUser.id.split('').reduce((acc, char) => {
            return acc + char.charCodeAt(0);
        }, 0) % colors.length;
        
        return colors[index];
    }
    
    /**
     * Get system info for debugging
     */
    getSystemInfo() {
        return {
            currentUser: this.currentUser,
            isAuthenticated: this.isAuthenticated,
            preferences: this.preferences,
            profile: this.profile
        };
    }
}

// Make globally available
window.UserProfileSystem = UserProfileSystem; 
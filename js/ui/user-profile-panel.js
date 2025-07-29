// ===================================
// USER PROFILE PANEL
// ===================================

/**
 * UserProfilePanel - UI component for user profile management
 * Provides login, profile editing, and preferences
 */
class UserProfilePanel {
    constructor() {
        this.panel = null;
        this.isVisible = false;
        this.userProfileSystem = null;
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Listen for user profile system events
        if (window.app?.userProfileSystem) {
            this.userProfileSystem = window.app.userProfileSystem;
            this.userProfileSystem.addListener('userChanged', (user) => {
                this.updateDisplay();
            });
        }
    }
    
    /**
     * Show the profile panel
     */
    show() {
        if (this.isVisible) return;
        
        this.createPanel();
        document.body.appendChild(this.panel);
        this.isVisible = true;
        this.updateDisplay();
        
        // Focus on username field if not logged in
        if (!this.userProfileSystem?.isUserAuthenticated()) {
            const usernameField = this.panel.querySelector('#username');
            if (usernameField) {
                usernameField.focus();
            }
        }
    }
    
    /**
     * Hide the profile panel
     */
    hide() {
        if (this.panel) {
            this.panel.remove();
            this.panel = null;
        }
        this.isVisible = false;
    }
    
    /**
     * Toggle panel visibility
     */
    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }
    
    /**
     * Create the panel HTML
     */
    createPanel() {
        this.panel = document.createElement('div');
        this.panel.className = 'user-profile-panel';
        this.panel.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #2a2a2a;
            border: 1px solid #444;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            padding: 16px;
            min-width: 280px;
            max-width: 320px;
            z-index: 1000;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            color: #e0e0e0;
            font-size: 13px;
        `;
        
        this.panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h2 style="margin: 0; font-size: 16px; font-weight: 600; color: #e0e0e0;">User Profile</h2>
                <button id="close-btn" style="
                    background: none;
                    border: none;
                    font-size: 18px;
                    cursor: pointer;
                    padding: 2px;
                    border-radius: 4px;
                    color: #ccc;
                ">×</button>
            </div>
            
            <div id="login-section" style="display: none;">
                <h3 style="margin: 0 0 12px 0; font-size: 14px; color: #e0e0e0;">Login</h3>
                <form id="login-form">
                    <div style="margin-bottom: 12px;">
                        <label for="username" style="display: block; margin-bottom: 4px; font-size: 12px; color: #ccc;">Username</label>
                        <input type="text" id="username" name="username" style="
                            width: 100%;
                            padding: 6px 8px;
                            border: 1px solid #555;
                            border-radius: 4px;
                            font-size: 12px;
                            background: #1a1a1a;
                            color: #e0e0e0;
                            box-sizing: border-box;
                        " placeholder="Enter username">
                    </div>
                    <button type="submit" style="
                        width: 100%;
                        padding: 8px;
                        background: #4a4a4a;
                        color: #e0e0e0;
                        border: 1px solid #666;
                        border-radius: 4px;
                        font-size: 12px;
                        cursor: pointer;
                    ">Login</button>
                </form>
            </div>
            
            <div id="profile-section" style="display: none;">
                <div style="display: flex; align-items: center; margin-bottom: 16px;">
                    <div id="user-avatar" style="
                        width: 32px;
                        height: 32px;
                        border-radius: 50%;
                        background: #4a4a4a;
                        color: #e0e0e0;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 14px;
                        font-weight: 600;
                        margin-right: 10px;
                        border: 1px solid #666;
                    "></div>
                    <div>
                        <div id="user-name" style="font-size: 14px; font-weight: 600; color: #e0e0e0;"></div>
                        <div id="user-email" style="font-size: 11px; color: #999;"></div>
                    </div>
                </div>
                
                <div style="margin-bottom: 16px;">
                    <h3 style="margin: 0 0 10px 0; font-size: 13px; color: #e0e0e0;">Preferences</h3>
                    <div style="margin-bottom: 6px;">
                        <label style="display: flex; align-items: center; font-size: 12px; color: #ccc;">
                            <input type="checkbox" id="show-grid" style="margin-right: 6px;">
                            Show grid by default
                        </label>
                    </div>
                    <div style="margin-bottom: 6px;">
                        <label style="display: flex; align-items: center; font-size: 12px; color: #ccc;">
                            <input type="checkbox" id="show-titles" style="margin-right: 6px;">
                            Show node titles
                        </label>
                    </div>
                    <div style="margin-bottom: 6px;">
                        <label style="display: flex; align-items: center; font-size: 12px; color: #ccc;">
                            <input type="checkbox" id="show-performance" style="margin-right: 6px;">
                            Show performance stats
                        </label>
                    </div>
                    <div style="margin-bottom: 6px;">
                        <label style="display: flex; align-items: center; font-size: 12px; color: #ccc;">
                            <input type="checkbox" id="enable-animations" style="margin-right: 6px;">
                            Enable smooth animations
                        </label>
                    </div>
                </div>
                
                <div style="display: flex; gap: 6px;">
                    <button id="logout-btn" style="
                        flex: 1;
                        padding: 6px 12px;
                        background: #5a2a2a;
                        color: #e0e0e0;
                        border: 1px solid #7a4a4a;
                        border-radius: 4px;
                        font-size: 11px;
                        cursor: pointer;
                    ">Logout</button>
                    <button id="save-btn" style="
                        flex: 1;
                        padding: 6px 12px;
                        background: #2a5a2a;
                        color: #e0e0e0;
                        border: 1px solid #4a7a4a;
                        border-radius: 4px;
                        font-size: 11px;
                        cursor: pointer;
                    ">Save Preferences</button>
                </div>
            </div>
            
            <div id="anonymous-section" style="display: none;">
                <p style="margin: 0 0 12px 0; color: #999; font-size: 12px;">
                    You're using ImageCanvas as a guest. Login to save your preferences and projects.
                </p>
                <button id="create-account-btn" style="
                    width: 100%;
                    padding: 8px;
                    background: #4a4a4a;
                    color: #e0e0e0;
                    border: 1px solid #666;
                    border-radius: 4px;
                    font-size: 12px;
                    cursor: pointer;
                ">Create Account</button>
            </div>
        `;
        
        // Add event listeners
        this.setupPanelEventListeners();
    }
    
    /**
     * Setup panel event listeners
     */
    setupPanelEventListeners() {
        // Close button
        const closeBtn = this.panel.querySelector('#close-btn');
        closeBtn.addEventListener('click', () => this.hide());
        
        // Login form
        const loginForm = this.panel.querySelector('#login-form');
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });
        
        // Logout button
        const logoutBtn = this.panel.querySelector('#logout-btn');
        logoutBtn.addEventListener('click', () => this.handleLogout());
        
        // Save preferences button
        const saveBtn = this.panel.querySelector('#save-btn');
        saveBtn.addEventListener('click', () => this.savePreferences());
        
        // Create account button
        const createAccountBtn = this.panel.querySelector('#create-account-btn');
        createAccountBtn.addEventListener('click', () => this.createAnonymousUser());
        
        // Preference checkboxes
        const showGridCheckbox = this.panel.querySelector('#show-grid');
        const showTitlesCheckbox = this.panel.querySelector('#show-titles');
        const showPerformanceCheckbox = this.panel.querySelector('#show-performance');
        const enableAnimationsCheckbox = this.panel.querySelector('#enable-animations');
        
        showGridCheckbox.addEventListener('change', (e) => {
            this.userProfileSystem?.setPreference('showGrid', e.target.checked);
        });
        
        showTitlesCheckbox.addEventListener('change', (e) => {
            this.userProfileSystem?.setPreference('showTitles', e.target.checked);
        });
        
        showPerformanceCheckbox.addEventListener('change', (e) => {
            this.userProfileSystem?.setPreference('showPerformance', e.target.checked);
        });
        
        enableAnimationsCheckbox.addEventListener('change', (e) => {
            this.userProfileSystem?.setPreference('enableAnimations', e.target.checked);
        });
    }
    
    /**
     * Update panel display based on user state
     */
    updateDisplay() {
        if (!this.panel) return;
        
        const loginSection = this.panel.querySelector('#login-section');
        const profileSection = this.panel.querySelector('#profile-section');
        const anonymousSection = this.panel.querySelector('#anonymous-section');
        
        if (this.userProfileSystem?.isUserAuthenticated()) {
            // Show profile section
            loginSection.style.display = 'none';
            anonymousSection.style.display = 'none';
            profileSection.style.display = 'block';
            
            // Update user info
            const user = this.userProfileSystem.currentUser;
            const userName = this.panel.querySelector('#user-name');
            const userEmail = this.panel.querySelector('#user-email');
            const userAvatar = this.panel.querySelector('#user-avatar');
            
            userName.textContent = user.username;
            userEmail.textContent = user.email || 'No email provided';
            userAvatar.textContent = user.username.charAt(0).toUpperCase();
            userAvatar.style.backgroundColor = this.userProfileSystem.getUserColor();
            
            // Update preferences
            const showGridCheckbox = this.panel.querySelector('#show-grid');
            const showTitlesCheckbox = this.panel.querySelector('#show-titles');
            const showPerformanceCheckbox = this.panel.querySelector('#show-performance');
            const enableAnimationsCheckbox = this.panel.querySelector('#enable-animations');
            
            showGridCheckbox.checked = this.userProfileSystem.getPreference('showGrid', true);
            showTitlesCheckbox.checked = this.userProfileSystem.getPreference('showTitles', false);
            showPerformanceCheckbox.checked = this.userProfileSystem.getPreference('showPerformance', false);
            enableAnimationsCheckbox.checked = this.userProfileSystem.getPreference('enableAnimations', true);
            
        } else if (this.userProfileSystem?.currentUser) {
            // Show anonymous section
            loginSection.style.display = 'none';
            profileSection.style.display = 'none';
            anonymousSection.style.display = 'block';
            
        } else {
            // Show login section
            profileSection.style.display = 'none';
            anonymousSection.style.display = 'none';
            loginSection.style.display = 'block';
        }
    }
    
    /**
     * Handle login form submission
     */
    async handleLogin() {
        const username = this.panel.querySelector('#username').value.trim();
        
        if (!username) {
            alert('Please enter a username');
            return;
        }
        
        try {
            const result = await this.userProfileSystem.login({ username });
            
            if (result.success) {
                this.updateDisplay();
                if (window.unifiedNotifications) {
                    window.unifiedNotifications.success('Login successful', {
                        detail: `Welcome, ${result.user.username}!`
                    });
                }
            } else {
                alert(result.error || 'Login failed');
            }
        } catch (error) {
            console.error('Login error:', error);
            alert('Login failed');
        }
    }
    
    /**
     * Handle logout
     */
    handleLogout() {
        this.userProfileSystem?.logout();
        this.updateDisplay();
        
        if (window.unifiedNotifications) {
            window.unifiedNotifications.info('Logged out successfully');
        }
    }
    
    /**
     * Create anonymous user
     */
    async createAnonymousUser() {
        try {
            await this.userProfileSystem?.createAnonymousUser();
            this.updateDisplay();
            
            if (window.unifiedNotifications) {
                window.unifiedNotifications.success('Anonymous account created', {
                    detail: 'You can now save preferences and projects'
                });
            }
        } catch (error) {
            console.error('Failed to create anonymous user:', error);
            alert('Failed to create account');
        }
    }
    
    /**
     * Save user preferences
     */
    savePreferences() {
        if (!this.userProfileSystem) return;
        
        // Preferences are already saved via event listeners
        if (window.unifiedNotifications) {
            window.unifiedNotifications.success('Preferences saved');
        }
    }
}

// Make globally available
window.UserProfilePanel = UserProfilePanel; 
# User Profile System Implementation Plan

## Overview
This plan outlines the implementation of a robust user profile system that maintains backward compatibility with the existing guest functionality while adding full authentication and profile features. This will also lay the groundwork for the "follow user view" feature.

## Current State Analysis
- Users are currently stored in SQLite with basic fields (username, display_name, avatar_path)
- System generates random usernames like `user-${tabId.substr(-8)}` for guests
- Multiple tabs per user are already supported
- No authentication system currently exists

## 1. Authentication Layer

### JWT-Based Authentication
- Implement JWT tokens for secure authentication
- Add login/register endpoints to the server:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/validate`
  - `POST /api/auth/refresh`

### Authentication UI
- Create modal component for login/registration
- Add "Sign In / Register" button to UI
- Show user profile info when logged in
- Maintain guest functionality without authentication

### Security Implementation
- Use bcrypt for password hashing (cost factor 12)
- Implement secure session management
- Add CSRF protection
- Rate limiting on auth endpoints

## 2. Enhanced User Model

### Database Schema Updates
```sql
-- Add to users table
ALTER TABLE users ADD COLUMN email TEXT UNIQUE;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN is_guest BOOLEAN DEFAULT 1;
ALTER TABLE users ADD COLUMN preferences JSON DEFAULT '{}';
ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN status TEXT CHECK(status IN ('online', 'away', 'offline')) DEFAULT 'online';
ALTER TABLE users ADD COLUMN last_seen DATETIME DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT 0;
ALTER TABLE users ADD COLUMN reset_token TEXT;
ALTER TABLE users ADD COLUMN reset_token_expires DATETIME;

-- Create indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_is_guest ON users(is_guest);
```

## 3. Session Management

### Implementation Details
- Use express-session with SQLite store
- Configure secure session cookies
- Handle multi-tab sessions (already partially implemented)
- Session timeout after 30 days of inactivity
- "Remember me" functionality

### Session Store
```javascript
// Use connect-sqlite3 for session persistence
const SQLiteStore = require('connect-sqlite3')(session);
app.use(session({
    store: new SQLiteStore({
        db: 'sessions.db',
        dir: './server/database'
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    }
}));
```

## 4. Profile Features

### Profile Customization
- Profile settings page with:
  - Avatar upload (store in `/uploads/avatars/`)
  - Display name editing
  - Bio/description
  - Email preferences
  - UI theme preferences

### Profile API Endpoints
- `GET /api/users/:userId/profile`
- `PUT /api/users/profile` (update own profile)
- `POST /api/users/avatar` (upload avatar)
- `DELETE /api/users/avatar`

### Public Profile View
- Accessible at `/users/:username`
- Shows public information only
- Lists public projects (when implemented)
- Shows collaboration statistics

## 5. Guest to User Migration

### Conversion Flow
1. Guest clicks "Create Account"
2. Enter email and password
3. Server updates existing user record:
   - Set `is_guest = false`
   - Add email and password_hash
   - Preserve all existing data
4. All work history is retained
5. Can merge sessions across devices using same email

### Implementation
```javascript
async convertGuestToUser(guestId, email, password) {
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Check if email already exists
    const existingUser = await db.getUserByEmail(email);
    if (existingUser) {
        // Merge accounts if needed
        await this.mergeAccounts(guestId, existingUser.id);
        return existingUser;
    }
    
    // Update guest to full user
    await db.run(`
        UPDATE users 
        SET email = ?, 
            password_hash = ?, 
            is_guest = 0,
            email_verified = 0
        WHERE id = ?
    `, [email, passwordHash, guestId]);
    
    // Send verification email
    await this.sendVerificationEmail(email);
    
    return await db.getUser(guestId);
}
```

## 6. Follow User View Feature Preparation

### Database Updates
```sql
-- Add to active_sessions table
ALTER TABLE active_sessions ADD COLUMN following_user_id INTEGER REFERENCES users(id);
ALTER TABLE active_sessions ADD COLUMN viewport_data JSON;

-- Create follow permissions table
CREATE TABLE follow_permissions (
    follower_id INTEGER NOT NULL REFERENCES users(id),
    followed_id INTEGER NOT NULL REFERENCES users(id),
    permission TEXT CHECK(permission IN ('allowed', 'blocked')) DEFAULT 'allowed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, followed_id)
);
```

### Real-time Viewport Sync
- Track camera position and zoom in sessions
- Emit viewport updates on camera changes
- Subscribe to followed user's viewport updates
- Smooth interpolation between positions

## 7. Implementation Phases

### Phase 1: Core Authentication (Week 1)
- Database schema updates
- JWT implementation
- Basic login/register endpoints
- Session management

### Phase 2: UI Integration (Week 2)
- Login/register modal
- Profile display in UI
- Guest mode preservation
- Session persistence

### Phase 3: Profile Features (Week 3)
- Profile customization page
- Avatar upload
- Preferences system
- Public profiles

### Phase 4: Migration & Polish (Week 4)
- Guest to user conversion
- Account merging
- Email verification
- Testing and bug fixes

### Phase 5: Follow Feature Prep (Future)
- Viewport tracking
- Permission system
- Follow UI components
- Real-time sync optimization

## 8. Best Practices & Security

### Security Measures
1. **Password Policy**
   - Minimum 8 characters
   - Require mix of letters and numbers
   - Password strength indicator

2. **Rate Limiting**
   ```javascript
   const rateLimit = require('express-rate-limit');
   const authLimiter = rateLimit({
       windowMs: 15 * 60 * 1000, // 15 minutes
       max: 5, // 5 requests per window
       message: 'Too many login attempts'
   });
   app.use('/api/auth', authLimiter);
   ```

3. **Input Sanitization**
   - Validate all inputs with express-validator
   - Sanitize user-generated content
   - Prevent SQL injection with parameterized queries

4. **Secure Headers**
   ```javascript
   const helmet = require('helmet');
   app.use(helmet());
   ```

### Development Considerations
- Maintain backward compatibility
- Progressive enhancement approach
- Feature flags for gradual rollout
- Comprehensive logging for auth events
- Regular security audits

## 9. Testing Strategy

### Unit Tests
- Authentication logic
- Password hashing/verification
- Session management
- Profile updates

### Integration Tests
- Login/logout flow
- Guest to user conversion
- Multi-tab session handling
- Profile API endpoints

### E2E Tests
- Complete user journey
- Guest mode functionality
- Profile customization
- Security scenarios

## 10. Monitoring & Analytics

### Metrics to Track
- User registration rate
- Guest to user conversion rate
- Login success/failure rates
- Session duration
- Profile completion rate

### Logging
- Authentication events
- Profile changes
- Security incidents
- Performance metrics

## Conclusion

This user profile system provides a solid foundation for user management while maintaining the simplicity of guest access. The phased approach allows for incremental implementation and testing, ensuring system stability throughout the process. The infrastructure put in place will directly support the future "follow user view" feature and other collaborative enhancements.
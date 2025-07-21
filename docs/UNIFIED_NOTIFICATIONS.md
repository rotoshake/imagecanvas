# Unified Notifications System

## Overview
The Unified Notifications System consolidates all user-facing messages into a single, consistent notification interface. It combines network status indicators, app notifications, and system messages into one cohesive UI component.

## Features

### 1. App Notifications
- **Success Messages**: Green notifications for successful operations
- **Error Messages**: Red notifications for errors and failures
- **Warning Messages**: Orange notifications for warnings
- **Info Messages**: Blue notifications for general information
- **Custom Duration**: Configurable display duration
- **Progress Bars**: Visual timer for auto-dismissing notifications

### 2. Network Status
- **Temporary Notifications**: Connection status shown as standard notifications
- **Status Types**: 
  - Connected (success, 3 seconds)
  - Connecting (warning, 3 seconds)
  - Disconnected (error, persistent until reconnected)
  - Error (error, 5 seconds)
- **Live Updates**: Real-time status changes with smooth transitions
- **Status Details**: Optional detail text for additional context

### 3. Advanced Features
- **Notification IDs**: Update existing notifications without creating duplicates
- **Persistent Messages**: Notifications that don't auto-dismiss
- **Closeable Options**: User-dismissible notifications
- **Batch Operations**: Show multiple notifications simultaneously
- **Clear All**: Remove all non-persistent notifications at once
- **Responsive Design**: Adapts to mobile screens

## Usage

### Basic Notifications
```javascript
// Success notification
unifiedNotifications.success('File saved successfully');

// Error notification
unifiedNotifications.error('Failed to upload file');

// Warning notification
unifiedNotifications.warning('Large file size may affect performance');

// Info notification
unifiedNotifications.info('Click and drag to move nodes');
```

### Advanced Options
```javascript
// Custom duration (10 seconds)
unifiedNotifications.show({
    type: 'info',
    message: 'Processing your request...',
    duration: 10000
});

// With detail text
unifiedNotifications.show({
    type: 'success',
    message: 'Upload complete',
    detail: 'image.jpg (2.3 MB)',
    duration: 5000
});

// Persistent notification with ID
const notificationId = unifiedNotifications.show({
    type: 'info',
    message: 'Syncing changes...',
    persistent: true,
    id: 'sync-status'
});

// Update existing notification
unifiedNotifications.update('sync-status', {
    type: 'success',
    message: 'Sync complete',
    detail: '5 changes synchronized'
});
```

### Network Status
```javascript
// Update connection status
unifiedNotifications.updateConnectionStatus('connected');
unifiedNotifications.updateConnectionStatus('connecting', 'Reconnecting...');
unifiedNotifications.updateConnectionStatus('disconnected', 'Server unavailable');
unifiedNotifications.updateConnectionStatus('error', 'Authentication failed');
```

## Visual Design

### Notification Styles
- **Modern Design**: Rounded corners, subtle shadows, and smooth animations
- **Dark Theme**: All notifications use a dark background for consistency
- **Icons**: Type-specific icons for quick visual recognition
- **Glass Effect**: Backdrop blur for a modern, layered appearance

### Animation
- **Slide In**: Notifications slide in from the right
- **Fade Out**: Smooth opacity transition when dismissing
- **Pulse Effect**: Connection status dot pulses when connecting

### Layout
- **Fixed Position**: Top-right corner of the screen
- **Stacking**: Multiple notifications stack vertically
- **Max Width**: Limited to 360px for readability
- **Responsive**: Full width on mobile devices

## Implementation Details

### Architecture
- **Singleton Pattern**: Single global instance manages all notifications
- **Map Storage**: Notifications tracked by unique IDs
- **DOM Management**: Efficient creation and removal of elements
- **Event Handling**: Click handlers for dismissible notifications

### Integration Points
1. **App.js**: Redirects `showNotification` to unified system
2. **NetworkLayer**: Connection status updates
3. **DragDropManager**: File operation feedback
4. **CanvasNavigator**: Canvas operation confirmations
5. **CollaborativeUndoRedoManager**: Undo/redo warnings

### Performance
- **Debouncing**: Prevents notification spam
- **Auto-cleanup**: Removes DOM elements after animations
- **Lightweight**: Minimal memory footprint
- **CSS Animations**: Hardware-accelerated transitions

## Migration from Old Systems

### Removed Components
- `connection-status.js`: Standalone connection indicator
- Individual notification implementations in various files
- Duplicate message display logic

### Updated Methods
- `app.showNotification()` now uses unified system
- `app.updateConnectionStatus()` added for network status
- `networkLayer.showStatus()` removed (was causing errors)

## Benefits

1. **Consistency**: All notifications look and behave the same
2. **Maintainability**: Single codebase for all notifications
3. **User Experience**: Cleaner, more professional appearance
4. **Accessibility**: Proper ARIA attributes and keyboard support
5. **Flexibility**: Easy to add new notification types or features
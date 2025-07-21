# ImageCanvas API Reference

## REST API Endpoints

### Authentication

#### POST /api/auth/login
Login with username and password.

**Request Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "token": "jwt-token",
  "user": {
    "id": "number",
    "username": "string"
  }
}
```

#### POST /api/auth/register
Create a new user account.

**Request Body:**
```json
{
  "username": "string",
  "password": "string",
  "email": "string"
}
```

**Response:**
```json
{
  "token": "jwt-token",
  "user": {
    "id": "number",
    "username": "string"
  }
}
```

#### POST /api/auth/logout
Logout current user.

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "message": "Logged out successfully"
}
```

### Projects

#### GET /api/projects
Get all projects for the authenticated user.

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "projects": [
    {
      "id": "string",
      "name": "string",
      "created_at": "timestamp",
      "updated_at": "timestamp",
      "thumbnail": "base64-string"
    }
  ]
}
```

#### POST /api/projects
Create a new project.

**Headers:**
- `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "name": "string"
}
```

**Response:**
```json
{
  "id": "string",
  "name": "string",
  "created_at": "timestamp"
}
```

#### DELETE /api/projects/:id
Delete a project.

**Headers:**
- `Authorization: Bearer <token>`

**Response:**
```json
{
  "message": "Project deleted successfully"
}
```

### File Upload

#### POST /api/upload
Upload media files to the server.

**Headers:**
- `Authorization: Bearer <token>`
- `Content-Type: multipart/form-data`

**Form Data:**
- `file`: Binary file data
- `projectId`: Project ID (optional)

**Response:**
```json
{
  "url": "/uploads/filename.ext",
  "filename": "filename.ext",
  "size": 12345,
  "mimetype": "image/jpeg",
  "thumbnails": {
    "64": "/thumbnails/filename_64.webp",
    "256": "/thumbnails/filename_256.webp",
    "512": "/thumbnails/filename_512.webp"
  }
}
```

## WebSocket Events

### Connection

#### connect
Fired when client connects to server.

**Client → Server:**
```javascript
socket.on('connect', () => {
  // Connection established
});
```

#### disconnect
Fired when client disconnects.

**Server → Client:**
```javascript
socket.on('disconnect', (reason) => {
  // Handle disconnection
});
```

### Canvas Operations

#### join-canvas
Join a specific canvas for collaboration.

**Client → Server:**
```javascript
socket.emit('join-canvas', {
  canvasId: 'canvas-uuid',
  userId: 'user-id'
});
```

**Server → Client:**
```javascript
socket.on('canvas-joined', {
  canvasId: 'canvas-uuid',
  state: { /* full canvas state */ },
  users: [ /* active users */ ]
});
```

#### leave-canvas
Leave the current canvas.

**Client → Server:**
```javascript
socket.emit('leave-canvas', {
  canvasId: 'canvas-uuid'
});
```

### State Synchronization

#### operation
Send an operation to be applied.

**Client → Server:**
```javascript
socket.emit('operation', {
  type: 'move|resize|rotate|add|remove|update',
  nodeId: 'node-uuid',
  data: { /* operation-specific data */ },
  timestamp: Date.now()
});
```

**Server → All Clients:**
```javascript
socket.on('operation', {
  type: 'move|resize|rotate|add|remove|update',
  nodeId: 'node-uuid',
  data: { /* operation-specific data */ },
  userId: 'originator-id',
  timestamp: Date.now()
});
```

#### state-sync
Request full state synchronization.

**Client → Server:**
```javascript
socket.emit('state-sync-request', {
  canvasId: 'canvas-uuid'
});
```

**Server → Client:**
```javascript
socket.on('state-sync', {
  nodes: [ /* all canvas nodes */ ],
  version: 123,
  timestamp: Date.now()
});
```

### User Presence

#### cursor-move
Broadcast cursor position.

**Client → Server:**
```javascript
socket.emit('cursor-move', {
  x: 100,
  y: 200,
  canvasId: 'canvas-uuid'
});
```

**Server → Other Clients:**
```javascript
socket.on('user-cursor', {
  userId: 'user-id',
  x: 100,
  y: 200
});
```

#### selection-change
Broadcast selection changes.

**Client → Server:**
```javascript
socket.emit('selection-change', {
  nodeIds: ['node-1', 'node-2'],
  canvasId: 'canvas-uuid'
});
```

**Server → Other Clients:**
```javascript
socket.on('user-selection', {
  userId: 'user-id',
  nodeIds: ['node-1', 'node-2']
});
```

## Operation Types

### Move Operation
```javascript
{
  type: 'move',
  nodeId: 'node-uuid',
  data: {
    x: 100,
    y: 200,
    prevX: 50,
    prevY: 100
  }
}
```

### Resize Operation
```javascript
{
  type: 'resize',
  nodeId: 'node-uuid',
  data: {
    width: 300,
    height: 200,
    prevWidth: 250,
    prevHeight: 150
  }
}
```

### Rotate Operation
```javascript
{
  type: 'rotate',
  nodeId: 'node-uuid',
  data: {
    rotation: 45,
    prevRotation: 0
  }
}
```

### Add Node Operation
```javascript
{
  type: 'add',
  data: {
    node: {
      id: 'node-uuid',
      type: 'image|video|text',
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      rotation: 0,
      data: { /* type-specific data */ }
    }
  }
}
```

### Remove Node Operation
```javascript
{
  type: 'remove',
  nodeId: 'node-uuid',
  data: {
    node: { /* full node data for undo */ }
  }
}
```

### Update Node Operation
```javascript
{
  type: 'update',
  nodeId: 'node-uuid',
  data: {
    updates: { /* properties to update */ },
    previous: { /* previous values */ }
  }
}
```

## Error Responses

### HTTP Errors
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": { /* optional additional info */ }
  }
}
```

### WebSocket Errors
```javascript
socket.on('error', {
  code: 'ERROR_CODE',
  message: 'Error description',
  operation: { /* failed operation */ }
});
```

### Error Codes
- `AUTH_REQUIRED`: Authentication required
- `INVALID_TOKEN`: Invalid or expired token
- `CANVAS_NOT_FOUND`: Canvas doesn't exist
- `PERMISSION_DENIED`: Insufficient permissions
- `INVALID_OPERATION`: Operation validation failed
- `SYNC_ERROR`: State synchronization failed
- `UPLOAD_FAILED`: File upload error
- `SIZE_LIMIT_EXCEEDED`: File too large
- `INVALID_FILE_TYPE`: Unsupported file format
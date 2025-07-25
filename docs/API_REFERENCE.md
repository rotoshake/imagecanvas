# ImageCanvas API Reference

## REST API Endpoints

### Base URL
- Development: `http://localhost:3000`
- Production: Configure as needed

### Authentication
Currently no authentication required (development mode). Production deployments should implement proper authentication.

### Endpoints

#### File Upload

##### `POST /api/upload`
Upload an image or video file via HTTP.

**Headers:**
- `Content-Type: multipart/form-data`

**Body (multipart):**
- `file`: The file to upload (required)
- `hash`: SHA-256 hash of the file (optional, will be calculated if not provided)

**Response:**
```json
{
  "success": true,
  "url": "/uploads/1234567890-abc123.jpg",
  "hash": "sha256hash...",
  "filename": "original-name.jpg",
  "size": 2048576,
  "width": 1920,
  "height": 1080,
  "thumbnails": {
    "64": "/thumbnails/64/1234567890-abc123.webp",
    "128": "/thumbnails/128/1234567890-abc123.webp",
    "256": "/thumbnails/256/1234567890-abc123.webp",
    "512": "/thumbnails/512/1234567890-abc123.webp",
    "1024": "/thumbnails/1024/1234567890-abc123.webp",
    "2048": "/thumbnails/2048/1234567890-abc123.webp"
  },
  "existingFile": false  // true if file already existed
}
```

**Status Codes:**
- `200`: Success
- `400`: No file provided or invalid file type
- `500`: Server error

#### Projects

##### `GET /projects`
Get all projects.

**Response:**
```json
[
  {
    "id": 1,
    "name": "My Project",
    "description": "Project description",
    "owner_id": 1,
    "created_at": "2024-01-01T00:00:00Z",
    "last_modified": "2024-01-02T00:00:00Z"
  }
]
```

##### `POST /projects`
Create a new project.

**Body:**
```json
{
  "name": "Project Name",
  "description": "Optional description",
  "ownerId": 1
}
```

**Response:**
```json
{
  "id": 2,
  "name": "Project Name",
  "description": "Optional description",
  "owner_id": 1,
  "created_at": "2024-01-01T00:00:00Z"
}
```

##### `GET /projects/:id`
Get a specific project.

##### `PUT /projects/:id`
Update project (currently only name).

**Body:**
```json
{
  "name": "New Project Name"
}
```

##### `DELETE /projects/:id`
Delete a project and all associated data.

##### `GET /projects/user/:userId`
Get all projects for a specific user (owned or collaborating).

#### Canvas Operations

##### `GET /projects/:id/canvas`
Get canvas state for a project.

**Response:**
```json
{
  "success": true,
  "canvas_data": {
    "nodes": [...],
    "navigation_state": {
      "scale": 1.0,
      "offset": [0, 0],
      "timestamp": 1234567890
    }
  }
}
```

##### `PUT /projects/:id/canvas`
Save complete canvas state.

**Body:**
```json
{
  "canvas_data": {
    "nodes": [...],
    "navigation_state": {...}
  },
  "userId": 1
}
```

##### `PATCH /projects/:id/canvas`
Update navigation state only.

**Body:**
```json
{
  "navigation_state": {
    "scale": 1.5,
    "offset": [100, 200],
    "timestamp": 1234567890
  }
}
```

#### Database Maintenance

##### `GET /database/size`
Get current database size.

**Response:**
```json
{
  "success": true,
  "sizeInBytes": 10485760,
  "sizeFormatted": "10 MB"
}
```

##### `POST /database/cleanup`
Clean up database (remove orphaned data, old operations, etc.).

**Body (optional):**
```json
{
  "aggressive": true,  // Remove all non-essential data
  "keepDays": 30      // Keep data from last N days
}
```

**Response:**
```json
{
  "success": true,
  "deleted": {
    "files": 5,
    "operations": 100,
    "users": 10,
    "imageDataOperations": 50
  },
  "newSize": {
    "bytes": 5242880,
    "formatted": "5 MB"
  },
  "previousSize": {
    "bytes": 10485760,
    "formatted": "10 MB"
  }
}
```

##### `POST /database/vacuum`
Run SQLite VACUUM to reclaim space.

**Response:**
```json
{
  "success": true,
  "message": "Database vacuumed successfully",
  "duration": 1234  // milliseconds
}
```

#### Static Files

##### `GET /uploads/:filename`
Serve uploaded files.

##### `GET /thumbnails/:size/:filename`
Serve generated thumbnails.
- Sizes: 64, 128, 256, 512, 1024, 2048
- Format: WebP with fallback to original format
- Cache headers included for performance

## WebSocket Events

### Connection
Connect to WebSocket server at the base URL using Socket.IO client.

### Client → Server Events

#### `join_project`
Join a project room for collaboration.

**Data:**
```json
{
  "projectId": 1,
  "username": "user123",
  "displayName": "John Doe",
  "tabId": "tab-123"
}
```

#### `leave_project`
Leave the current project.

**Data:**
```json
{
  "projectId": 1
}
```

#### `execute_operation`
Execute a state-modifying operation.

**Data:**
```json
{
  "operationId": "op-123",
  "type": "node_create",
  "params": {
    "type": "media/image",
    "pos": [100, 200],
    "properties": {
      "serverUrl": "/uploads/image.jpg",
      "filename": "image.jpg",
      "hash": "abc123..."
    }
  },
  "undoData": {...},
  "transactionId": "txn-456"
}
```

**Note:** Operation size must be under 100KB. Large data (images) must be uploaded via HTTP first.

#### `undo_operation`
Request undo of the last operation.

**Data:**
```json
{
  "projectId": 1
}
```

#### `redo_operation`
Request redo of the last undone operation.

**Data:**
```json
{
  "projectId": 1
}
```

#### `request_undo_state`
Request current undo/redo state.

**Data:**
```json
{
  "projectId": 1
}
```

#### `clear_undo_history`
Clear all undo history for a project.

**Data:**
```json
{
  "projectId": 1
}
```

#### `begin_transaction`
Start a transaction for grouping operations.

**Data:**
```json
{
  "source": "bulk_move"
}
```

#### `commit_transaction`
Commit the current transaction.

**Data:**
```json
{}
```

#### `abort_transaction`
Abort the current transaction.

**Data:**
```json
{}
```

#### `request_full_sync`
Request complete state sync from server.

**Data:**
```json
{
  "projectId": 1
}
```

### Server → Client Events

#### `project_joined`
Confirmation of joining a project.

**Data:**
```json
{
  "project": {...},
  "session": {
    "userId": 1,
    "username": "user123",
    "displayName": "John Doe",
    "tabId": "tab-123"
  },
  "sequenceNumber": 100
}
```

#### `operation_ack`
Operation accepted and applied.

**Data:**
```json
{
  "operationId": "op-123",
  "stateVersion": 101
}
```

#### `operation_rejected`
Operation rejected by server.

**Data:**
```json
{
  "operationId": "op-123",
  "error": "Operation too large",
  "details": {
    "size": 150000,
    "maxSize": 102400
  }
}
```

#### `state_update`
State changed by another user or undo/redo.

**Data:**
```json
{
  "stateVersion": 102,
  "changes": {
    "added": [...],
    "updated": [...],
    "removed": [...]
  },
  "operationId": "op-456",
  "fromUserId": 2,
  "isUndo": false
}
```

#### `undo_state_update`
Undo/redo state changed.

**Data:**
```json
{
  "projectId": 1,
  "undoState": {
    "canUndo": true,
    "canRedo": false,
    "undoCount": 5,
    "redoCount": 0,
    "nextUndo": {
      "type": "single",
      "operationId": "op-123"
    }
  }
}
```

#### `undo_success`
Undo operation completed.

**Data:**
```json
{
  "success": true,
  "undoneOperations": [...],
  "stateUpdate": {...}
}
```

#### `redo_success`
Redo operation completed.

**Data:**
```json
{
  "success": true,
  "redoneOperations": [...],
  "stateUpdate": {...}
}
```

#### `transaction_started`
Transaction begun.

**Data:**
```json
{
  "transactionId": "txn-123"
}
```

#### `transaction_committed`
Transaction committed.

**Data:**
```json
{
  "transactionId": "txn-123",
  "operationCount": 5
}
```

#### `transaction_aborted`
Transaction aborted and rolled back.

**Data:**
```json
{
  "transactionId": "txn-123",
  "reason": "User cancelled" | "Timeout" | "Error"
}
```

#### `user_joined`
Another user joined the project.

**Data:**
```json
{
  "userId": 2,
  "username": "user456",
  "displayName": "Jane Smith",
  "tabId": "tab-456"
}
```

#### `user_left`
User completely left the project.

**Data:**
```json
{
  "userId": 2,
  "username": "user456"
}
```

#### `active_users`
List of all active users in project.

**Data:**
```json
[
  {
    "userId": 1,
    "username": "user123",
    "displayName": "John Doe",
    "tabs": [
      {
        "socketId": "socket-123",
        "tabId": "tab-123"
      }
    ]
  }
]
```

#### `full_state_sync`
Complete state from server.

**Data:**
```json
{
  "state": {
    "nodes": [...],
    "version": 100
  },
  "stateVersion": 100
}
```

#### `error`
General error message.

**Data:**
```json
{
  "message": "Error description"
}
```

## Operation Types

### Node Operations

- `node_create` - Create a new node
- `node_move` - Move node(s)
- `node_resize` - Resize node(s)
- `node_rotate` - Rotate node(s)
- `node_delete` - Delete node(s)
- `node_duplicate` - Duplicate node(s)
- `node_property_update` - Update node properties
- `node_batch_property_update` - Update multiple nodes
- `node_reset` - Reset node transformations

### Media Operations

- `image_upload_complete` - Mark image upload complete
- `video_toggle` - Toggle video play/pause
- `thumbnail_generated` - Thumbnail generation complete
- `image_cache_update` - Image added to cache

### Canvas Operations

- `canvas_clear` - Clear entire canvas
- `navigation_update` - Update viewport position/zoom
- `bulk_operation_start` - Begin bulk operation
- `bulk_operation_progress` - Bulk operation progress update
- `bulk_operation_complete` - Bulk operation finished

## Error Codes

- `NOT_AUTHENTICATED` - User not authenticated
- `NOT_AUTHORIZED` - User lacks permission
- `OPERATION_TOO_LARGE` - Operation exceeds size limit
- `INVALID_OPERATION` - Operation validation failed
- `STATE_CONFLICT` - State version mismatch
- `UNDO_CONFLICT` - Cannot undo due to other users' changes
- `FILE_TOO_LARGE` - Upload exceeds size limit
- `INVALID_FILE_TYPE` - File type not supported
- `HASH_MISMATCH` - File hash doesn't match provided hash
- `TRANSACTION_TIMEOUT` - Transaction exceeded time limit
- `TRANSACTION_CONFLICT` - Nested transactions not allowed
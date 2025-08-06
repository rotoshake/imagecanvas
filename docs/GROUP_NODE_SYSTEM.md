# Group Node System

## Overview

The Group Node system provides a container-based organization mechanism for ImageCanvas, allowing users to group related nodes together for better project organization and management.

## Features

### Core Functionality
- **Container Nodes**: Groups act as containers that can hold any type of node
- **Visual Boundaries**: Automatic calculation of group bounds with padding
- **Drag and Drop**: Intuitive drag-and-drop to add/remove nodes from groups
- **Parent-Child Relationships**: Maintains hierarchy during operations
- **Single Parent Rule**: Each node can only belong to one group at a time

### Visual Design
- **Title Bar**: Draggable header with customizable group name
- **Screen-Space Aware**: Title bar height adjusts based on zoom level
- **Thin Bar Mode**: Compact visualization when zoomed out
- **Transparency**: Semi-transparent background for content visibility
- **Rounded Corners**: Modern visual styling

### Animations
- **Smooth Transitions**: Animated bounds updates when adding/removing nodes
- **Expand Animation**: Groups smoothly expand to accommodate new nodes
- **200ms Duration**: Quick but noticeable transitions
- **Cubic Easing**: Natural-feeling animation curves

## Implementation Details

### Node Management

```javascript
// Adding a node to a group
groupNode.addChildNode(nodeId);

// Adding multiple nodes at once (single animation)
groupNode.addMultipleChildNodes([node1Id, node2Id, node3Id]);

// Removing a node
groupNode.removeChildNode(nodeId);
```

### Bounds Calculation

Groups automatically calculate their bounds to contain all child nodes with appropriate padding:

- **Base Padding**: 30 world units around content
- **Screen Padding**: Minimum 15 screen pixels maintained
- **Title Bar Space**: Dynamically calculated based on zoom
- **Expand-Only Mode**: Groups can expand but don't shrink automatically

### Screen-Space Rendering

The group's title bar adapts to the current zoom level:

```javascript
// Target screen-space height: 20 pixels
// Actual world-space height varies with zoom
const titleBarHeight = 20 / viewport.scale;
```

### Interaction Handling

Groups support various interactions:

1. **Title Bar Drag**: Move entire group and contents
2. **Resize Handles**: Manually adjust group size (when expanded)
3. **Double-Click Title**: Fit group bounds to content
4. **Node Containment**: 70% overlap required to add node

## Server Synchronization

### Operations
- `group_create`: Create new group
- `group_add_nodes`: Add nodes to group
- `group_remove_nodes`: Remove nodes from group
- `group_resize`: Update group bounds
- `group_update_nodes`: Sync child node list

### Data Structure
```javascript
{
  type: 'container/group',
  properties: {
    childNodes: ['node1', 'node2'],
    isCollapsed: false,
    style: {
      backgroundColor: 'rgba(60, 60, 60, 0.5)',
      borderColor: 'rgba(120, 120, 120, 0.9)',
      // ... other style properties
    }
  }
}
```

## User Guide

### Creating Groups
1. Select nodes to group
2. Press 'G' or use context menu
3. Group is created with selected nodes

### Managing Groups
- **Add Nodes**: Drag nodes into group (70% overlap)
- **Remove Nodes**: Drag nodes out of group
- **Move Group**: Drag title bar
- **Resize**: Drag corner handles
- **Fit to Content**: Double-click title bar

### Copy/Paste Behavior
- Copying a group includes all child nodes
- Pasting maintains parent-child relationships
- Nested groups are preserved

## Performance Considerations

### Optimization Strategies
1. **Cached Bounds**: Child bounds cached until invalidated
2. **Deferred Sync**: Server updates delayed during animations
3. **Batch Operations**: Multiple nodes added in single operation
4. **Render Order**: Groups render behind regular nodes

### Memory Management
- Groups are lightweight containers
- No duplicate rendering of child nodes
- Efficient Set-based child tracking

## Known Limitations

1. **No Collapse Feature**: Currently always expanded
2. **No Nested Group Limits**: Infinite nesting possible
3. **No Group Locking**: Contents always editable
4. **No Group Templates**: Each group starts empty

## Future Enhancements

### Planned Features
- Group templates and presets
- Collapse/expand functionality
- Group-level operations (transform all)
- Smart alignment within groups
- Group-specific permissions
- Export groups as components

### UI Improvements
- Group thumbnails when collapsed
- Color coding and icons
- Group statistics display
- Quick group switching

## Integration with Other Systems

### Z-Order System
- Groups respect layer ordering
- Child nodes inherit group's base layer
- Layer operations work on entire groups

### Undo/Redo
- Group operations fully undoable
- Maintains operation atomicity
- Child node changes tracked

### Color Correction
- Group-level color adjustments (future)
- Batch processing of group contents
- Inherited corrections from parent groups
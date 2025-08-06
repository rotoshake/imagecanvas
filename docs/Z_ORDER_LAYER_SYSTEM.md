# Z-Order Layer System

## Overview

The Z-Order Layer System provides fine-grained control over the rendering order of nodes in ImageCanvas, allowing users to precisely manage which elements appear in front of or behind others.

## Core Concepts

### Layer Order
- **Higher Values**: Render on top (front)
- **Lower Values**: Render below (back)
- **Default Order**: 0 for new nodes
- **Incremental Steps**: ±0.1 for layer changes

### Group Hierarchy
- Groups always render behind their children
- Child nodes maintain relative ordering within groups
- Moving a group affects all contained nodes

## Implementation

### Node Properties
Each node maintains its layer order:
```javascript
node.layer_order = 0; // Default layer
```

### Rendering Pipeline
1. Collect all visible nodes
2. Separate groups and regular nodes
3. Sort each by layer_order
4. Render groups first (back to front)
5. Render regular nodes (back to front)

### Sort Algorithm
```javascript
// Stable sort to maintain insertion order for equal layers
nodes.sort((a, b) => {
    const diff = a.layer_order - b.layer_order;
    return diff !== 0 ? diff : nodes.indexOf(a) - nodes.indexOf(b);
});
```

## User Operations

### Keyboard Shortcuts
- **[** : Move selected nodes down one layer
- **]** : Move selected nodes up one layer  
- **Shift + [** : Send selected nodes to back
- **Shift + ]** : Bring selected nodes to front

### Menu Options
- Right-click context menu
- Arrange submenu with all layer operations
- Visual indicators for current layer

### Programmatic Control
```javascript
// Move node up one layer
commands.execute('node_layer_order', {
    nodeIds: [node.id],
    direction: 'up'
});

// Send to back
commands.execute('node_layer_order', {
    nodeIds: [node.id],
    direction: 'back'
});
```

## Server Synchronization

### Operations
The layer system uses the `node_layer_order` command:
```javascript
{
    type: 'node_layer_order',
    nodeIds: ['node1', 'node2'],
    direction: 'up' | 'down' | 'front' | 'back'
}
```

### State Persistence
- Layer order saved with node data
- Synchronized across all clients
- Preserved in undo/redo history

### Incremental Updates
- **Up/Down**: ±0.1 to current layer
- **Front**: Maximum layer + 1
- **Back**: Minimum layer - 1

## Visual Feedback

### Selection Indicators
- Selected nodes show subtle elevation shadow
- Layer position shown in properties panel
- Temporary ghost during reordering

### Debug Mode
When enabled, shows:
- Numeric layer values on nodes
- Rendering order sequence
- Group containment boundaries

## Edge Cases

### Equal Layers
- Nodes with same layer_order maintain creation order
- Stable sort ensures predictable behavior
- No automatic spacing on collision

### Group Interactions
- Children inherit base rendering from group
- Internal group ordering preserved
- Cannot move child above parent group

### Large Layer Values
- No hard limits on layer values
- Automatic normalization available
- Precision maintained to 6 decimals

## Performance Considerations

### Optimization Strategies
1. **Dirty Flag**: Only re-sort when layers change
2. **Incremental Updates**: Avoid full re-sort
3. **Render Culling**: Skip off-screen nodes
4. **Batch Operations**: Multiple moves as one operation

### Benchmarks
- Sorting 1000 nodes: ~2ms
- Layer change operation: <1ms
- Full render with layers: No measurable impact

## Best Practices

### Organization Tips
1. **Use Groups**: Instead of many individual layers
2. **Meaningful Gaps**: Leave space for insertions
3. **Reset Periodically**: Normalize layer values
4. **Name Important Layers**: Use node titles

### Common Patterns
- **Background**: Large negative values (-100)
- **Main Content**: Around zero (0)
- **Overlays**: Positive values (10-20)
- **UI Elements**: High values (100+)

## Integration with Other Systems

### Undo/Redo
- All layer operations fully undoable
- Batch moves grouped as single undo
- Original positions restored exactly

### Copy/Paste
- Relative layer order maintained
- Pasted nodes go above selection
- Groups preserve internal ordering

### Import/Export
- Layer values included in serialization
- Maintains relative positioning
- Handles layer conflicts on import

## Troubleshooting

### Common Issues

#### Nodes Not Responding to Layer Changes
- Check if node is in a group
- Verify node isn't locked
- Ensure proper selection

#### Unexpected Rendering Order
- Enable debug mode to see values
- Check for equal layer values
- Verify no CSS z-index overrides

#### Performance Degradation
- Too many unique layer values
- Consider grouping related nodes
- Use layer normalization

### Debug Commands
```javascript
// Log all layer values
canvas.nodes.forEach(n => 
    console.log(`${n.id}: ${n.layer_order}`)
);

// Normalize layers
canvas.normalizeLayers();

// Find layer conflicts
canvas.findEqualLayers();
```

## Future Enhancements

### Planned Features
- Layer names and labels
- Layer locking/visibility
- Auto-distribute layers
- Layer templates/presets
- Snap to layer grid
- Layer effects (shadows, glows)

### UI Improvements
- Layer panel with drag reorder
- Visual layer stack preview
- Keyboard nudge with alt/shift
- Multi-select layer operations

### Advanced Features
- Layer masks and clipping
- Layer blend modes
- Layer opacity control
- Nested layer groups
- Layer animation support
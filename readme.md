# ImageCanvas Prototype

A modular image canvas application built with LiteGraph (or a custom implementation).

## Project Structure

```
root/
├── index.html              # Main HTML file
├── css/
│   ├── litegraph.css      # Official LiteGraph styles (if using official library)
│   └── app.css            # Custom application styles
├── js/
│   ├── litegraph.js       # Official LiteGraph library (if using official library)
│   ├── app.js             # Main application logic
│   ├── nodes/
│   │   └── ImageNode.js   # Custom image node implementation
│   └── utils/
│       └── state.js       # State management utilities
```

## Features

- Drag & drop images to add them to the canvas
- Move nodes by dragging
- Alt+drag to duplicate a node
- Ctrl/Cmd+C to copy, Ctrl/Cmd+V to paste
- Ctrl/Cmd+D to duplicate selected nodes
- Delete/Backspace to remove selected nodes
- Drag resize handle (bottom-right corner) to resize
- Mouse wheel to zoom, drag empty space to pan
- Auto-save state to localStorage
- DPI scaling support
- **Text nodes with word wrapping and WYSIWYG editing**
- **Non-uniform scaling for text nodes**

## Text Node Editing & Features

- **Word Wrapping:** Text nodes automatically wrap text to fit the node's width, both when editing and when rendered on the canvas.
- **WYSIWYG Editing:** Double-click a text node to edit its content in-place with a live overlay that matches the final rendered appearance (font, size, wrapping, and padding).
- **Non-Uniform Scaling:** Text nodes can be resized freely in both width and height, and the text will reflow and scale accordingly.
- **Live Bounding Box:** The node's bounding box automatically adjusts its height to fit the wrapped text as you type.
- **Consistent Alignment:** The overlay and the canvas rendering are visually aligned for a seamless editing experience.

## Using the Official LiteGraph Library

If you want to use the official LiteGraph library instead of the custom implementation:

1. Uncomment the LiteGraph CSS link in `index.html`:
   ```html
   <link rel="stylesheet" href="css/litegraph.css">
   ```

2. Uncomment the LiteGraph script in `index.html`:
   ```html
   <script src="js/litegraph.js"></script>
   ```

3. The app will automatically detect and use the official library if it's loaded.

## Using the Custom Implementation

By default, the application uses a custom, simplified implementation of LiteGraph that's included in `app.js`. This implementation provides all the necessary features for the image canvas prototype without requiring the full LiteGraph library.

## Customization

### Adding New Node Types

To add a new node type:

1. Create a new file in `js/nodes/` (e.g., `TextNode.js`)
2. Define your node class similar to `ImageNode.js`
3. Include the script in `index.html`
4. Register the node type in `app.js`

### Modifying Styles

- Edit `css/app.css` for custom styles
- The styles are designed to work with both the official LiteGraph and the custom implementation

## Browser Compatibility

- Modern browsers with ES6 support
- Chrome, Firefox, Safari, Edge (latest versions)
- Requires localStorage support for state persistence

## Development Notes

- The state is automatically saved to localStorage
- State includes node positions, properties, and canvas view
- The application handles high-DPI displays automatically
- File reading is done through FileReader API (no server required)
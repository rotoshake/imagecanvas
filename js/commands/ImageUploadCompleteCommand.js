/**
 * ImageUploadCompleteCommand - Notifies the server when an image upload completes
 * This allows the server to update all nodes with the matching hash with the serverUrl
 */

class ImageUploadCompleteCommand extends Command {
    constructor(params, origin = 'local') {
        super('image_upload_complete', params, origin);
    }
    
    validate() {
        const { hash, serverUrl } = this.params;
        
        if (!hash) {
            return { valid: false, error: 'Missing image hash' };
        }
        
        if (!serverUrl) {
            return { valid: false, error: 'Missing server URL' };
        }
        
        return { valid: true };
    }
    
    async execute(context) {
        const { graph } = context;
        
        // This is a server-only operation, but we update local nodes too
        // Find all nodes with this hash and update them
        let updatedNodes = [];
        
        for (const node of graph.nodes) {
            if (node.type === 'media/image' && 
                node.properties.hash === this.params.hash && 
                !node.properties.serverUrl) {
                
                // Update local node with server URL
                node.properties.serverUrl = this.params.serverUrl;
                if (this.params.serverFilename) {
                    node.properties.serverFilename = this.params.serverFilename;
                }
                
                updatedNodes.push(node);
            }
        }
        
        console.log(`🔄 Updated ${updatedNodes.length} local nodes with serverUrl for hash ${this.params.hash.substring(0, 8)}...`);
        
        // No undo for this operation - it's just syncing metadata
        this.executed = true;
        return { updatedNodes };
    }
    
    async undo(context) {
        // Image upload complete cannot be undone
        return { success: false, error: 'Image upload complete cannot be undone' };
    }
}

// Register command
if (typeof window !== 'undefined') {
    window.ImageUploadCompleteCommand = ImageUploadCompleteCommand;
}
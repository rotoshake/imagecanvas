/**
 * Image Preview Worker - Handles heavy image processing operations off the main thread
 * Supports dimension reading and preview generation for bulk operations
 */

// Worker-specific implementations (no DOM access)
class WorkerImageProcessor {
    /**
     * Process image file for dimensions and previews
     * @param {ArrayBuffer} fileBuffer - File data as ArrayBuffer
     * @param {string} fileName - Original file name
     * @param {string} mimeType - File MIME type
     * @param {Object} options - Processing options
     */
    static async processImage(fileBuffer, fileName, mimeType, options = {}) {
        const {
            previewSizes = [128, 256],
            quality = 0.8,
            format = 'image/webp'
        } = options;

        try {
            // Create ImageBitmap from the buffer
            const blob = new Blob([fileBuffer], { type: mimeType });
            const bitmap = await createImageBitmap(blob);
            
            const result = {
                fileName,
                width: bitmap.width,
                height: bitmap.height,
                previews: {}
            };

            // Generate previews at different sizes
            for (const size of previewSizes) {
                try {
                    const aspectRatio = bitmap.width / bitmap.height;
                    const previewWidth = aspectRatio >= 1 ? size : Math.round(size * aspectRatio);
                    const previewHeight = aspectRatio >= 1 ? Math.round(size / aspectRatio) : size;
                    
                    // Create resized bitmap
                    const resizedBitmap = await createImageBitmap(bitmap, {
                        resizeWidth: previewWidth,
                        resizeHeight: previewHeight,
                        resizeQuality: 'medium'
                    });
                    
                    // Convert to blob using OffscreenCanvas
                    const canvas = new OffscreenCanvas(previewWidth, previewHeight);
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(resizedBitmap, 0, 0);
                    
                    const previewBlob = await canvas.convertToBlob({ 
                        type: format, 
                        quality 
                    });
                    
                    // Convert to ArrayBuffer for transfer
                    result.previews[size] = await previewBlob.arrayBuffer();
                    
                    // Clean up
                    resizedBitmap.close();
                    
                } catch (previewError) {
                    console.warn(`Failed to generate ${size}px preview for ${fileName}:`, previewError);
                }
            }
            
            // Clean up original bitmap
            bitmap.close();
            
            return result;
            
        } catch (error) {
            throw new Error(`Failed to process ${fileName}: ${error.message}`);
        }
    }
    
    /**
     * Read just dimensions from image header (fast method)
     */
    static async getDimensionsOnly(fileBuffer, fileName, mimeType) {
        try {
            // For dimension-only reading, we can use the same approach but skip preview generation
            const blob = new Blob([fileBuffer], { type: mimeType });
            const bitmap = await createImageBitmap(blob);
            
            const result = {
                fileName,
                width: bitmap.width,
                height: bitmap.height
            };
            
            bitmap.close();
            return result;
            
        } catch (error) {
            // Fallback: try header parsing for common formats
            if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
                return this.getJPEGDimensions(fileBuffer, fileName);
            } else if (mimeType === 'image/png') {
                return this.getPNGDimensions(fileBuffer, fileName);
            }
            
            throw new Error(`Failed to read dimensions for ${fileName}: ${error.message}`);
        }
    }
    
    /**
     * Read JPEG dimensions from header (worker version)
     */
    static getJPEGDimensions(buffer, fileName) {
        const view = new DataView(buffer);
        
        // JPEG starts with 0xFFD8
        if (view.getUint16(0) !== 0xFFD8) {
            throw new Error('Not a valid JPEG');
        }
        
        let offset = 2;
        while (offset < view.byteLength) {
            const marker = view.getUint16(offset);
            offset += 2;
            
            // SOF markers: 0xFFC0 to 0xFFCF (except 0xFFC4 and 0xFFC8)
            if (marker >= 0xFFC0 && marker <= 0xFFCF && marker !== 0xFFC4 && marker !== 0xFFC8) {
                // Skip length and precision
                offset += 3;
                const height = view.getUint16(offset);
                const width = view.getUint16(offset + 2);
                return { fileName, width, height };
            }
            
            // Skip segment
            const length = view.getUint16(offset);
            offset += length;
        }
        
        throw new Error('Could not find JPEG dimensions');
    }
    
    /**
     * Read PNG dimensions from header (worker version)
     */
    static getPNGDimensions(buffer, fileName) {
        const view = new DataView(buffer);
        
        // PNG signature: 137 80 78 71 13 10 26 10
        const signature = [137, 80, 78, 71, 13, 10, 26, 10];
        for (let i = 0; i < 8; i++) {
            if (view.getUint8(i) !== signature[i]) {
                throw new Error('Not a valid PNG');
            }
        }
        
        // IHDR chunk starts at byte 16
        const width = view.getUint32(16);
        const height = view.getUint32(20);
        
        return { fileName, width, height };
    }
}

// Message handler for the worker
self.onmessage = async function(e) {
    const { id, command, data } = e.data;
    
    try {
        let result;
        
        switch (command) {
            case 'processImage':
                result = await WorkerImageProcessor.processImage(
                    data.fileBuffer, 
                    data.fileName, 
                    data.mimeType, 
                    data.options
                );
                break;
                
            case 'getDimensionsOnly':
                result = await WorkerImageProcessor.getDimensionsOnly(
                    data.fileBuffer, 
                    data.fileName, 
                    data.mimeType
                );
                break;
                
            case 'processBatch':
                // Process multiple images in sequence to avoid memory issues
                const batchResults = [];
                for (const item of data.items) {
                    try {
                        const itemResult = await WorkerImageProcessor.processImage(
                            item.fileBuffer, 
                            item.fileName, 
                            item.mimeType, 
                            data.options
                        );
                        batchResults.push(itemResult);
                        
                        // Send progress update
                        self.postMessage({
                            id,
                            type: 'progress',
                            progress: batchResults.length / data.items.length,
                            completed: batchResults.length,
                            total: data.items.length
                        });
                        
                    } catch (itemError) {
                        console.error(`Batch processing failed for ${item.fileName}:`, itemError);
                        batchResults.push({
                            fileName: item.fileName,
                            error: itemError.message
                        });
                    }
                }
                result = batchResults;
                break;
                
            default:
                throw new Error(`Unknown command: ${command}`);
        }
        
        // Send success response
        self.postMessage({
            id,
            type: 'success',
            result
        });
        
    } catch (error) {
        // Send error response
        self.postMessage({
            id,
            type: 'error',
            error: error.message
        });
    }
};

// Handle worker errors
self.onerror = function(error) {
    console.error('Image Preview Worker Error:', error);
};
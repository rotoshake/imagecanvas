// ===================================
// IMAGE DIMENSION READER
// ===================================

/**
 * Fast image dimension reading without loading full image data
 * Reads just the header bytes to extract width/height
 */
class ImageDimensionReader {
    /**
     * Get dimensions from a File object without loading the full image
     * @param {File} file - The image file
     * @returns {Promise<{width: number, height: number}>}
     */
    static async getDimensions(file) {
        // For browsers that support createImageBitmap (fastest method)
        if (typeof createImageBitmap !== 'undefined') {
            try {
                const bitmap = await createImageBitmap(file);
                const dimensions = {
                    width: bitmap.width,
                    height: bitmap.height
                };
                bitmap.close(); // Clean up
                return dimensions;
            } catch (e) {
                
            }
        }

        // Fallback: Read just enough bytes to get dimensions from header
        const type = file.type;
        
        if (type === 'image/jpeg' || type === 'image/jpg') {
            return this.getJPEGDimensions(file);
        } else if (type === 'image/png') {
            return this.getPNGDimensions(file);
        } else if (type === 'image/gif') {
            return this.getGIFDimensions(file);
        } else if (type === 'image/webp') {
            return this.getWebPDimensions(file);
        } else {
            // Fallback to loading full image
            return this.getDimensionsViaImage(file);
        }
    }

    /**
     * Read JPEG dimensions from header
     */
    static async getJPEGDimensions(file) {
        const buffer = await this.readBytes(file, 0, 65536); // Read first 64KB
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
                return { width, height };
            }
            
            // Skip segment
            const length = view.getUint16(offset);
            offset += length;
        }
        
        throw new Error('Could not find JPEG dimensions');
    }

    /**
     * Read PNG dimensions from header
     */
    static async getPNGDimensions(file) {
        const buffer = await this.readBytes(file, 0, 24);
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
        
        return { width, height };
    }

    /**
     * Read GIF dimensions from header
     */
    static async getGIFDimensions(file) {
        const buffer = await this.readBytes(file, 0, 10);
        const view = new DataView(buffer);
        
        // Check GIF signature (GIF87a or GIF89a)
        const sig = String.fromCharCode(
            view.getUint8(0), view.getUint8(1), view.getUint8(2)
        );
        if (sig !== 'GIF') {
            throw new Error('Not a valid GIF');
        }
        
        const width = view.getUint16(6, true); // Little endian
        const height = view.getUint16(8, true);
        
        return { width, height };
    }

    /**
     * Read WebP dimensions from header
     */
    static async getWebPDimensions(file) {
        const buffer = await this.readBytes(file, 0, 30);
        const view = new DataView(buffer);
        
        // Check WebP signature
        const riff = String.fromCharCode(
            view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)
        );
        const webp = String.fromCharCode(
            view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)
        );
        
        if (riff !== 'RIFF' || webp !== 'WEBP') {
            throw new Error('Not a valid WebP');
        }
        
        // VP8 format
        const vp8 = String.fromCharCode(
            view.getUint8(12), view.getUint8(13), view.getUint8(14)
        );
        
        if (vp8 === 'VP8 ') {
            // Lossy WebP
            const width = view.getUint16(26, true) & 0x3FFF;
            const height = view.getUint16(28, true) & 0x3FFF;
            return { width: width + 1, height: height + 1 };
        } else if (vp8 === 'VP8L') {
            // Lossless WebP
            const bits = view.getUint32(21, true);
            const width = (bits & 0x3FFF) + 1;
            const height = ((bits >> 14) & 0x3FFF) + 1;
            return { width, height };
        }
        
        throw new Error('Unsupported WebP format');
    }

    /**
     * Fallback method using Image element
     */
    static async getDimensionsViaImage(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve({
                    width: img.naturalWidth,
                    height: img.naturalHeight
                });
            };
            
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load image'));
            };
            
            img.src = url;
        });
    }

    /**
     * Get dimensions and generate low-res previews efficiently
     * @param {File} file - The image file
     * @param {Object} options - Preview options
     * @returns {Promise<{width: number, height: number, previews: Object, bitmap?: ImageBitmap}>}
     */
    static async getDimensionsAndPreview(file, options = {}) {
        const { 
            previewSizes = [128, 256], 
            quality = 0.8, 
            format = 'image/webp',
            returnBitmap = false 
        } = options;
        
        let bitmap = null;
        let dimensions = null;
        
        try {
            // Use createImageBitmap for fastest loading (supports partial data)
            if (typeof createImageBitmap !== 'undefined') {
                bitmap = await createImageBitmap(file);
                dimensions = {
                    width: bitmap.width,
                    height: bitmap.height
                };
            } else {
                // Fallback: get dimensions first, then create bitmap
                dimensions = await this.getDimensions(file);
                bitmap = await this.createBitmapFromFile(file);
            }
            
            // Generate previews at different sizes
            const previews = {};
            for (const size of previewSizes) {
                try {
                    const aspectRatio = dimensions.width / dimensions.height;
                    const previewWidth = aspectRatio >= 1 ? size : Math.round(size * aspectRatio);
                    const previewHeight = aspectRatio >= 1 ? Math.round(size / aspectRatio) : size;
                    
                    // Create resized bitmap
                    let resizedBitmap;
                    if (bitmap.constructor.name === 'ImageBitmap' && typeof createImageBitmap !== 'undefined') {
                        // Use createImageBitmap resize for best performance
                        resizedBitmap = await createImageBitmap(bitmap, {
                            resizeWidth: previewWidth,
                            resizeHeight: previewHeight,
                            resizeQuality: 'medium'
                        });
                    } else {
                        // Fallback: canvas-based resize
                        resizedBitmap = await this.resizeBitmapWithCanvas(bitmap, previewWidth, previewHeight);
                    }
                    
                    // Convert to blob
                    const blob = await this.bitmapToBlob(resizedBitmap, quality, format);
                    previews[size] = blob;
                    
                    // Clean up resized bitmap
                    if (resizedBitmap.close) {
                        resizedBitmap.close();
                    }
                } catch (previewError) {
                    
                }
            }
            
            const result = {
                width: dimensions.width,
                height: dimensions.height,
                previews
            };
            
            // Optionally return the original bitmap for further use
            if (returnBitmap) {
                result.bitmap = bitmap;
            } else if (bitmap && bitmap.close) {
                bitmap.close();
            }
            
            return result;
            
        } catch (error) {
            // Clean up on error
            if (bitmap && bitmap.close) {
                bitmap.close();
            }
            throw new Error(`Failed to generate previews for ${file.name}: ${error.message}`);
        }
    }
    
    /**
     * Create ImageBitmap from file (fallback method)
     */
    static async createBitmapFromFile(file) {
        if (typeof createImageBitmap !== 'undefined') {
            return await createImageBitmap(file);
        }
        
        // Ultimate fallback: use Image element
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load image'));
            };
            
            img.src = url;
        });
    }
    
    /**
     * Resize bitmap using canvas (fallback method)
     */
    static async resizeBitmapWithCanvas(sourceBitmap, width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        
        // Use high-quality scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        ctx.drawImage(sourceBitmap, 0, 0, width, height);
        return canvas;
    }
    
    /**
     * Convert bitmap to blob efficiently
     */
    static async bitmapToBlob(bitmap, quality = 0.8, format = 'image/webp') {
        // For ImageBitmap, use OffscreenCanvas if available
        if (bitmap.constructor.name === 'ImageBitmap' && typeof OffscreenCanvas !== 'undefined') {
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0);
            return await canvas.convertToBlob({ type: format, quality });
        }
        
        // For regular canvas or Image elements
        let canvas = bitmap;
        if (!canvas.getContext) {
            // It's an Image element, draw to canvas
            canvas = document.createElement('canvas');
            canvas.width = bitmap.width || bitmap.naturalWidth;
            canvas.height = bitmap.height || bitmap.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0);
        }
        
        // Convert canvas to blob
        return new Promise((resolve, reject) => {
            try {
                if (canvas.convertToBlob) {
                    // OffscreenCanvas method
                    canvas.convertToBlob({ type: format, quality }).then(resolve).catch(reject);
                } else if (canvas.toBlob) {
                    // Regular Canvas method
                    canvas.toBlob(resolve, format, quality);
                } else {
                    // Fallback: dataURL to blob
                    const dataURL = canvas.toDataURL(format, quality);
                    fetch(dataURL).then(res => res.blob()).then(resolve).catch(reject);
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Read specific bytes from file
     */
    static readBytes(file, start, length) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            const slice = file.slice(start, start + length);
            
            reader.onload = () => {
                resolve(reader.result);
            };
            
            reader.onerror = () => {
                reject(new Error('Failed to read file'));
            };
            
            reader.readAsArrayBuffer(slice);
        });
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.ImageDimensionReader = ImageDimensionReader;
}
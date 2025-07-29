/**
 * Image WebP Converter - Handles conversion of images to lossless WebP format
 * Optimizes storage while maintaining perfect image quality
 */
class ImageWebPConverter {
    /**
     * Convert image file to lossless WebP format
     * @param {File} file - Original image file
     * @param {Object} options - Conversion options
     * @returns {Promise<{dataURL: string, blob: Blob, originalFormat: string}>}
     */
    static async convertToWebP(file, options = {}) {
        const {
            quality = 1.0, // 1.0 = lossless for WebP
            maxWidth = null,
            maxHeight = null,
            preserveMetadata = false
        } = options;

        const originalFormat = file.type;
        
        // If already WebP and no resizing needed, return as-is
        if (originalFormat === 'image/webp' && !maxWidth && !maxHeight) {
            const dataURL = await this.fileToDataURL(file);
            return {
                dataURL,
                blob: file,
                originalFormat,
                converted: false
            };
        }

        try {
            // Create image bitmap for high-quality processing
            const bitmap = await createImageBitmap(file);
            
            // Calculate target dimensions
            let targetWidth = bitmap.width;
            let targetHeight = bitmap.height;
            
            if (maxWidth || maxHeight) {
                const aspectRatio = bitmap.width / bitmap.height;
                
                if (maxWidth && targetWidth > maxWidth) {
                    targetWidth = maxWidth;
                    targetHeight = Math.round(maxWidth / aspectRatio);
                }
                
                if (maxHeight && targetHeight > maxHeight) {
                    targetHeight = maxHeight;
                    targetWidth = Math.round(maxHeight * aspectRatio);
                }
            }

            // Convert to WebP using canvas
            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            
            // Use high-quality scaling
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            
            // Draw the image
            ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
            
            // Clean up bitmap
            bitmap.close();
            
            // Convert to WebP blob
            const webpBlob = await new Promise((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to convert to WebP'));
                    }
                }, 'image/webp', quality);
            });
            
            // Convert to data URL
            const dataURL = await this.blobToDataURL(webpBlob);
            
            console.log(`📸 Converted ${originalFormat} (${file.size} bytes) to WebP (${webpBlob.size} bytes) - ${Math.round((1 - webpBlob.size / file.size) * 100)}% smaller`);
            
            return {
                dataURL,
                blob: webpBlob,
                originalFormat,
                converted: true,
                originalSize: file.size,
                webpSize: webpBlob.size,
                compressionRatio: file.size / webpBlob.size
            };
            
        } catch (error) {
            console.warn(`Failed to convert ${file.name} to WebP, using original format:`, error);
            
            // Fallback to original format
            const dataURL = await this.fileToDataURL(file);
            return {
                dataURL,
                blob: file,
                originalFormat,
                converted: false,
                error: error.message
            };
        }
    }
    
    /**
     * Convert multiple images to WebP in batch
     * @param {Array<File>} files - Array of image files
     * @param {Object} options - Conversion options
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<Array>} Array of conversion results
     */
    static async convertBatch(files, options = {}, onProgress = null) {
        const results = [];
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            
            try {
                const result = await this.convertToWebP(file, options);
                results.push(result);
                
                if (onProgress) {
                    onProgress(i + 1, files.length, result);
                }
                
            } catch (error) {
                console.error(`Batch conversion failed for ${file.name}:`, error);
                results.push({
                    error: error.message,
                    file: file.name,
                    converted: false
                });
            }
        }
        
        return results;
    }
    
    /**
     * Check if WebP is supported by the browser
     */
    static isWebPSupported() {
        if (typeof window === 'undefined') return false;
        
        // Check for WebP support
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        
        // Test lossless WebP support
        const dataURL = canvas.toDataURL('image/webp', 1.0);
        return dataURL.indexOf('data:image/webp') === 0;
    }
    
    /**
     * Get optimal WebP quality for different use cases
     */
    static getOptimalQuality(useCase) {
        switch (useCase) {
            case 'lossless':
            case 'archive':
            case 'editing':
                return 1.0; // Lossless
            case 'display':
            case 'web':
                return 0.9; // High quality
            case 'thumbnail':
            case 'preview':
                return 0.8; // Good quality, smaller size
            case 'bulk':
            case 'memory-optimized':
                return 0.7; // Reasonable quality, optimized size
            default:
                return 1.0; // Default to lossless
        }
    }
    
    /**
     * Calculate optimal dimensions for different use cases
     */
    static getOptimalDimensions(originalWidth, originalHeight, useCase) {
        const aspectRatio = originalWidth / originalHeight;
        
        switch (useCase) {
            case 'full':
            case 'lossless':
                return { width: originalWidth, height: originalHeight };
            
            case 'display':
                // Limit to reasonable display sizes (4K max)
                const maxDisplaySize = 3840;
                if (originalWidth > maxDisplaySize || originalHeight > maxDisplaySize) {
                    if (originalWidth > originalHeight) {
                        return { width: maxDisplaySize, height: Math.round(maxDisplaySize / aspectRatio) };
                    } else {
                        return { width: Math.round(maxDisplaySize * aspectRatio), height: maxDisplaySize };
                    }
                }
                return { width: originalWidth, height: originalHeight };
            
            case 'web':
                // Optimize for web display (2K max)
                const maxWebSize = 2048;
                if (originalWidth > maxWebSize || originalHeight > maxWebSize) {
                    if (originalWidth > originalHeight) {
                        return { width: maxWebSize, height: Math.round(maxWebSize / aspectRatio) };
                    } else {
                        return { width: Math.round(maxWebSize * aspectRatio), height: maxWebSize };
                    }
                }
                return { width: originalWidth, height: originalHeight };
            
            default:
                return { width: originalWidth, height: originalHeight };
        }
    }
    
    /**
     * Convert File to data URL
     */
    static fileToDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }
    
    /**
     * Convert Blob to data URL
     */
    static blobToDataURL(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read blob'));
            reader.readAsDataURL(blob);
        });
    }
    
    /**
     * Get conversion statistics
     */
    static getConversionStats(results) {
        const stats = {
            total: results.length,
            converted: 0,
            failed: 0,
            originalSize: 0,
            webpSize: 0,
            totalSaved: 0,
            avgCompressionRatio: 0
        };
        
        let totalCompressionRatio = 0;
        
        results.forEach(result => {
            if (result.converted) {
                stats.converted++;
                stats.originalSize += result.originalSize || 0;
                stats.webpSize += result.webpSize || 0;
                totalCompressionRatio += result.compressionRatio || 1;
            } else if (result.error) {
                stats.failed++;
            }
        });
        
        stats.totalSaved = stats.originalSize - stats.webpSize;
        stats.avgCompressionRatio = stats.converted > 0 ? totalCompressionRatio / stats.converted : 1;
        
        return stats;
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.ImageWebPConverter = ImageWebPConverter;
}
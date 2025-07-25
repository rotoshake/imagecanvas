/**
 * ImageUploadManager - Handles HTTP uploads of images to the server
 * Allows immediate local display while uploading in the background
 */
class ImageUploadManager {
    constructor() {
        this.uploadQueue = new Map(); // hash -> upload promise
        // Use the configured server URL, not the current page host
        this.uploadUrl = CONFIG.SERVER.API_BASE + '/api/upload';
        
        // Bundled tracking removed - now handled by unified progress system
    }

    /**
     * Upload image data to server via HTTP
     * Returns a promise that resolves to the server URL
     */
    async uploadImage(imageData, filename, hash) {
        // Check if already uploading
        if (this.uploadQueue.has(hash)) {
            console.log(`⏳ Upload already in progress for ${hash}`);
            return this.uploadQueue.get(hash);
        }

        // Bundle tracking is now handled by unified progress system

        // Create upload promise
        const uploadPromise = this._performUpload(imageData, filename, hash);
        this.uploadQueue.set(hash, uploadPromise);

        try {
            const result = await uploadPromise;
            this.uploadQueue.delete(hash);
            return result;
        } catch (error) {
            this.uploadQueue.delete(hash);
            throw error;
        }
    }

    async _performUpload(imageData, filename, hash) {
        console.log(`📤 Uploading image ${filename} (${hash})`);
        
        // Progress is now handled by unified progress system

        try {
            // Convert base64 to blob
            const blob = await this._dataURLToBlob(imageData);
            
            // Create form data
            const formData = new FormData();
            formData.append('file', blob, filename); // Server expects 'file' field
            formData.append('hash', hash);

            // Upload with progress tracking
            const response = await this._uploadWithProgress(formData, filename, hash);

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

            const result = await response.json();
            console.log(`✅ Upload complete for ${filename}:`, result);
            
            // Notify unified progress system of completion
            if (window.imageProcessingProgress) {
                window.imageProcessingProgress.updateUploadProgress(hash, 1);
            }

            return {
                url: result.url,
                hash: hash,
                size: blob.size,
                filename: result.filename || filename
            };
        } catch (error) {
            console.error(`❌ Upload failed for ${filename}:`, error);
            
            // Notify unified progress system of failure
            if (window.imageProcessingProgress) {
                window.imageProcessingProgress.markFailed(hash, 'upload');
            }
            
            throw error;
        }
    }

    async _uploadWithProgress(formData, filename, hash) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            // Track upload progress
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percentComplete = Math.round((e.loaded / e.total) * 100);
                    this._updateProgress(filename, percentComplete, hash);
                }
            });

            xhr.addEventListener('load', () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve({
                        ok: true,
                        status: xhr.status,
                        statusText: xhr.statusText,
                        json: () => Promise.resolve(JSON.parse(xhr.responseText))
                    });
                } else {
                    reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
                }
            });

            xhr.addEventListener('error', () => {
                reject(new Error('Network error during upload'));
            });

            xhr.addEventListener('abort', () => {
                reject(new Error('Upload aborted'));
            });

            xhr.open('POST', this.uploadUrl);
            xhr.send(formData);
        });
    }

    _updateProgress(filename, percent, hash) {
        // Report progress to unified system
        if (window.imageProcessingProgress) {
            window.imageProcessingProgress.updateUploadProgress(hash, percent / 100);
        }
    }

    async _dataURLToBlob(dataURL) {
        const response = await fetch(dataURL);
        return response.blob();
    }

    /**
     * Check if an image is already uploaded
     */
    isUploading(hash) {
        return this.uploadQueue.has(hash);
    }

    /**
     * Get upload promise for a hash if it exists
     */
    getUploadPromise(hash) {
        return this.uploadQueue.get(hash);
    }
    
    // Legacy bundle methods removed - now handled by unified progress system
}

// Create global instance
window.imageUploadManager = new ImageUploadManager();
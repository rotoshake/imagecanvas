// js/actions/CompressionManager.js

class CompressionManager {
    constructor() {
        // Compression settings
        this.compressionThreshold = 1024; // 1KB - compress payloads larger than this
        this.compressionLevel = 6; // Compression level (1-9, higher = better compression but slower)
        
        // Check for compression support
        this.supportsCompression = this.checkCompressionSupport();
        
        // Statistics
        this.stats = {
            totalPayloads: 0,
            compressedPayloads: 0,
            originalBytes: 0,
            compressedBytes: 0,
            compressionTime: 0,
            decompressionTime: 0
        };
        
        console.log('🗜️ CompressionManager initialized', {
            supported: this.supportsCompression,
            threshold: this.compressionThreshold
        });
    }
    
    /**
     * Check if compression is supported in this environment
     */
    checkCompressionSupport() {
        try {
            // Check for CompressionStream API (modern browsers)
            if (typeof CompressionStream !== 'undefined') {
                return 'streams';
            }
            
            // Fallback to pako if available (lightweight gzip library)
            if (typeof pako !== 'undefined') {
                return 'pako';
            }
            
            // Check for native compression via TextEncoder/TextDecoder
            if (typeof TextEncoder !== 'undefined' && typeof TextDecoder !== 'undefined') {
                return 'basic';
            }
            
            return false;
        } catch (error) {
            console.warn('Compression support check failed:', error);
            return false;
        }
    }
    
    /**
     * Compress data if it exceeds the threshold
     */
    async compress(data) {
        const startTime = performance.now();
        
        // Serialize the data
        const jsonString = JSON.stringify(data);
        const originalSize = new TextEncoder().encode(jsonString).length;
        
        this.stats.totalPayloads++;
        this.stats.originalBytes += originalSize;
        
        // Check if compression is beneficial
        if (originalSize < this.compressionThreshold || !this.supportsCompression) {
            return {
                data: data,
                compressed: false,
                originalSize: originalSize,
                compressedSize: originalSize,
                compressionRatio: 1.0
            };
        }
        
        try {
            let compressedData;
            let compressedSize;
            
            switch (this.supportsCompression) {
                case 'streams':
                    ({ compressedData, compressedSize } = await this.compressWithStreams(jsonString));
                    break;
                    
                case 'pako':
                    ({ compressedData, compressedSize } = await this.compressWithPako(jsonString));
                    break;
                    
                case 'basic':
                    ({ compressedData, compressedSize } = await this.compressBasic(jsonString));
                    break;
                    
                default:
                    throw new Error('No compression method available');
            }
            
            const compressionRatio = originalSize / compressedSize;
            const compressionTime = performance.now() - startTime;
            
            this.stats.compressedPayloads++;
            this.stats.compressedBytes += compressedSize;
            this.stats.compressionTime += compressionTime;
            
            // Only use compression if it's actually beneficial (> 10% reduction)
            if (compressionRatio > 1.1) {
                return {
                    data: compressedData,
                    compressed: true,
                    originalSize: originalSize,
                    compressedSize: compressedSize,
                    compressionRatio: compressionRatio,
                    method: this.supportsCompression
                };
            } else {
                // Compression wasn't beneficial, return original
                return {
                    data: data,
                    compressed: false,
                    originalSize: originalSize,
                    compressedSize: originalSize,
                    compressionRatio: 1.0
                };
            }
            
        } catch (error) {
            console.warn('Compression failed, using original data:', error);
            return {
                data: data,
                compressed: false,
                originalSize: originalSize,
                compressedSize: originalSize,
                compressionRatio: 1.0,
                error: error.message
            };
        }
    }
    
    /**
     * Decompress data
     */
    async decompress(compressedResult) {
        if (!compressedResult.compressed) {
            return compressedResult.data;
        }
        
        const startTime = performance.now();
        
        try {
            let decompressedString;
            
            switch (compressedResult.method) {
                case 'streams':
                    decompressedString = await this.decompressWithStreams(compressedResult.data);
                    break;
                    
                case 'pako':
                    decompressedString = await this.decompressWithPako(compressedResult.data);
                    break;
                    
                case 'basic':
                    decompressedString = await this.decompressBasic(compressedResult.data);
                    break;
                    
                default:
                    throw new Error('Unknown compression method: ' + compressedResult.method);
            }
            
            const decompressionTime = performance.now() - startTime;
            this.stats.decompressionTime += decompressionTime;
            
            return JSON.parse(decompressedString);
            
        } catch (error) {
            console.error('Decompression failed:', error);
            throw new Error('Failed to decompress data: ' + error.message);
        }
    }
    
    /**
     * Compress using CompressionStream API
     */
    async compressWithStreams(text) {
        const stream = new CompressionStream('gzip');
        const writer = stream.writable.getWriter();
        const reader = stream.readable.getReader();
        
        const chunks = [];
        
        // Start reading compressed chunks
        const readPromise = (async () => {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
        })();
        
        // Write the data
        await writer.write(new TextEncoder().encode(text));
        await writer.close();
        
        // Wait for all chunks to be read
        await readPromise;
        
        // Combine chunks into single Uint8Array
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const compressedData = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            compressedData.set(chunk, offset);
            offset += chunk.length;
        }
        
        // Convert to base64 for transmission
        const base64 = this.uint8ArrayToBase64(compressedData);
        
        return {
            compressedData: base64,
            compressedSize: base64.length
        };
    }
    
    /**
     * Decompress using DecompressionStream API
     */
    async decompressWithStreams(base64Data) {
        const compressedData = this.base64ToUint8Array(base64Data);
        
        const stream = new DecompressionStream('gzip');
        const writer = stream.writable.getWriter();
        const reader = stream.readable.getReader();
        
        const chunks = [];
        
        // Start reading decompressed chunks
        const readPromise = (async () => {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
        })();
        
        // Write the compressed data
        await writer.write(compressedData);
        await writer.close();
        
        // Wait for all chunks to be read
        await readPromise;
        
        // Combine chunks and decode to string
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const decompressedData = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            decompressedData.set(chunk, offset);
            offset += chunk.length;
        }
        
        return new TextDecoder().decode(decompressedData);
    }
    
    /**
     * Compress using pako library (if available)
     */
    async compressWithPako(text) {
        if (typeof pako === 'undefined') {
            throw new Error('Pako library not available');
        }
        
        const input = new TextEncoder().encode(text);
        const compressed = pako.gzip(input, { level: this.compressionLevel });
        const base64 = this.uint8ArrayToBase64(compressed);
        
        return {
            compressedData: base64,
            compressedSize: base64.length
        };
    }
    
    /**
     * Decompress using pako library
     */
    async decompressWithPako(base64Data) {
        if (typeof pako === 'undefined') {
            throw new Error('Pako library not available');
        }
        
        const compressed = this.base64ToUint8Array(base64Data);
        const decompressed = pako.ungzip(compressed);
        return new TextDecoder().decode(decompressed);
    }
    
    /**
     * Basic compression using simple algorithms
     */
    async compressBasic(text) {
        // Simple run-length encoding for repeated patterns
        const compressed = this.runLengthEncode(text);
        const base64 = btoa(compressed);
        
        return {
            compressedData: base64,
            compressedSize: base64.length
        };
    }
    
    /**
     * Basic decompression
     */
    async decompressBasic(base64Data) {
        const compressed = atob(base64Data);
        return this.runLengthDecode(compressed);
    }
    
    /**
     * Simple run-length encoding
     */
    runLengthEncode(text) {
        let encoded = '';
        let i = 0;
        
        while (i < text.length) {
            let count = 1;
            const char = text[i];
            
            // Count consecutive characters
            while (i + count < text.length && text[i + count] === char && count < 255) {
                count++;
            }
            
            // Encode based on count
            if (count > 3 || char === '\x00') {
                // Use RLE encoding: \x00 + count + char
                encoded += '\x00' + String.fromCharCode(count) + char;
            } else {
                // Just repeat the character
                encoded += char.repeat(count);
            }
            
            i += count;
        }
        
        return encoded;
    }
    
    /**
     * Simple run-length decoding
     */
    runLengthDecode(encoded) {
        let decoded = '';
        let i = 0;
        
        while (i < encoded.length) {
            if (encoded[i] === '\x00' && i + 2 < encoded.length) {
                // RLE encoded sequence
                const count = encoded.charCodeAt(i + 1);
                const char = encoded[i + 2];
                decoded += char.repeat(count);
                i += 3;
            } else {
                // Regular character
                decoded += encoded[i];
                i++;
            }
        }
        
        return decoded;
    }
    
    /**
     * Convert Uint8Array to base64
     */
    uint8ArrayToBase64(bytes) {
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    
    /**
     * Convert base64 to Uint8Array
     */
    base64ToUint8Array(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
    
    /**
     * Update compression settings
     */
    configure(options) {
        if (options.threshold !== undefined) {
            this.compressionThreshold = Math.max(100, options.threshold);
        }
        if (options.level !== undefined) {
            this.compressionLevel = Math.max(1, Math.min(9, options.level));
        }
        
        console.log('🗜️ Compression settings updated:', {
            threshold: this.compressionThreshold,
            level: this.compressionLevel
        });
    }
    
    /**
     * Get compression statistics
     */
    getStats() {
        const totalSavings = this.stats.originalBytes - this.stats.compressedBytes;
        const averageRatio = this.stats.compressedPayloads > 0 ? 
            this.stats.originalBytes / this.stats.compressedBytes : 1;
        const compressionRate = this.stats.totalPayloads > 0 ?
            (this.stats.compressedPayloads / this.stats.totalPayloads) * 100 : 0;
        
        return {
            ...this.stats,
            totalSavings,
            averageRatio,
            compressionRate,
            averageCompressionTime: this.stats.compressedPayloads > 0 ?
                this.stats.compressionTime / this.stats.compressedPayloads : 0,
            averageDecompressionTime: this.stats.compressedPayloads > 0 ?
                this.stats.decompressionTime / this.stats.compressedPayloads : 0
        };
    }
    
    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalPayloads: 0,
            compressedPayloads: 0,
            originalBytes: 0,
            compressedBytes: 0,
            compressionTime: 0,
            decompressionTime: 0
        };
    }
}

// Make it globally available
window.CompressionManager = CompressionManager;
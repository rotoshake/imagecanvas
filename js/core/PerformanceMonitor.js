// ===================================
// PERFORMANCE MONITOR
// Real-time frame rate and performance tracking
// ===================================

class PerformanceMonitor {
    constructor() {
        this.enabled = true;
        this.showHUD = false; // Can be toggled for debugging
        
        // Listen for user preference changes
        this.setupPreferenceListener();
        
        // Frame timing
        this.lastFrameTime = performance.now();
        this.frameCount = 0;
        this.fps = 0;
        this.frameTimeHistory = [];
        this.maxHistorySize = 60; // Last 60 frames
        
        // Performance metrics
        this.metrics = {
            avgFrameTime: 0,
            maxFrameTime: 0,
            droppedFrames: 0,
            renderTime: 0,
            cullTime: 0,
            drawTime: 0,
            cpuUsage: 0,
            gpuTime: 0,
            memoryUsage: 0
        };
        
        // CPU/GPU monitoring
        this.cpuSamples = [];
        this.gpuSamples = [];
        this.maxSamples = 30; // Keep last 30 samples for averaging
        this.lastCPUTime = performance.now();
        this.lastIdleTime = 0;
        
        // GPU timing (if available)
        this.supportsGPUTiming = false;
        this.gpuTimingExt = null;
        this.setupGPUTiming();
        
        // Retry GPU setup after WebGL is initialized
        setTimeout(() => this.setupGPUTiming(), 1000);
        setTimeout(() => this.setupGPUTiming(), 3000);
        
        // Adaptive quality
        this.qualityLevel = 'high'; // high, medium, low
        this.consecutiveBadFrames = 0;
        this.qualityThresholds = {
            high: { target: 16.67, tolerance: 3 }, // 60fps with 3 bad frames tolerance
            medium: { target: 33.33, tolerance: 5 }, // 30fps with 5 bad frames tolerance
            low: { target: 50, tolerance: 10 } // 20fps with 10 bad frames tolerance
        };
        
        // Update interval
        this.updateInterval = 500; // Update stats every 500ms
        this.lastUpdate = performance.now();

    }
    
    /**
     * Setup GPU timing extension if available
     */
    setupGPUTiming() {
        // Try to get WebGL context from renderer
        if (window.app?.graphCanvas?.webglRenderer?.gl) {
            const gl = window.app.graphCanvas.webglRenderer.gl;
            
            // Check for timer query extension
            this.gpuTimingExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') ||
                               gl.getExtension('EXT_disjoint_timer_query');
            
            if (this.gpuTimingExt) {
                this.supportsGPUTiming = true;
            }
        }
    }
    
    /**
     * Setup listener for user preference changes
     */
    setupPreferenceListener() {
        // Check for user profile system and listen for preference changes
        if (window.app?.userProfileSystem) {
            window.app.userProfileSystem.addListener('preferenceChanged', (data) => {
                if (data.key === 'showPerformance') {
                    this.showHUD = data.value;
                    
                }
            });
            
            // Set initial state from user preferences
            const showPerformance = window.app.userProfileSystem.getPreference('showPerformance', false);
            this.showHUD = showPerformance;
        }
    }
    
    /**
     * Start frame measurement
     */
    startFrame() {
        if (!this.enabled) return;
        this.frameStartTime = performance.now();
    }
    
    /**
     * End frame measurement and update metrics
     */
    endFrame() {
        if (!this.enabled) return;
        
        const now = performance.now();
        const frameTime = now - this.lastFrameTime;
        this.lastFrameTime = now;
        
        // Track frame time
        this.frameTimeHistory.push(frameTime);
        if (this.frameTimeHistory.length > this.maxHistorySize) {
            this.frameTimeHistory.shift();
        }
        
        // Update metrics
        this.frameCount++;
        
        // Check for dropped frames (> 16.67ms for 60fps)
        if (frameTime > 16.67) {
            this.metrics.droppedFrames++;
        }
        
        // Update adaptive quality
        this.updateQualityLevel(frameTime);
        
        // Periodic metric updates
        if (now - this.lastUpdate > this.updateInterval) {
            this.updateMetrics();
            this.lastUpdate = now;
        }
    }
    
    /**
     * Mark a specific operation's timing
     */
    mark(operation, duration) {
        if (!this.enabled) return;
        this.metrics[operation + 'Time'] = duration;
    }
    
    /**
     * Update computed metrics
     */
    updateMetrics() {
        if (this.frameTimeHistory.length === 0) return;
        
        // Calculate average frame time
        const sum = this.frameTimeHistory.reduce((a, b) => a + b, 0);
        this.metrics.avgFrameTime = sum / this.frameTimeHistory.length;
        
        // Calculate max frame time
        this.metrics.maxFrameTime = Math.max(...this.frameTimeHistory);
        
        // Calculate FPS
        this.fps = Math.round(1000 / this.metrics.avgFrameTime);
        
        // Update CPU usage estimate
        this.updateCPUMetrics();
        
        // Update GPU metrics if available
        this.updateGPUMetrics();
        
        // Update memory usage
        this.updateMemoryMetrics();
        
        // Log if performance is poor
        // if (this.fps < 30) {
        //     console.warn(`⚠️ Low FPS detected: ${this.fps}fps (avg frame time: ${this.metrics.avgFrameTime.toFixed(1)}ms)`);
        // }
    }
    
    /**
     * Estimate CPU usage based on frame timing
     */
    updateCPUMetrics() {
        // Estimate CPU usage based on frame time vs idle time
        // This is a rough approximation since we can't directly access CPU stats in browser
        const now = performance.now();
        const elapsed = now - this.lastCPUTime;
        
        if (elapsed > 0) {
            // Estimate CPU usage as percentage of time spent in frame vs total time
            const busyTime = this.metrics.avgFrameTime;
            const totalTime = 1000 / 60; // Target 60fps frame time
            const cpuUsage = Math.min(100, (busyTime / totalTime) * 100);
            
            this.cpuSamples.push(cpuUsage);
            if (this.cpuSamples.length > this.maxSamples) {
                this.cpuSamples.shift();
            }
            
            // Average the samples
            const avgCPU = this.cpuSamples.reduce((a, b) => a + b, 0) / this.cpuSamples.length;
            this.metrics.cpuUsage = Math.round(avgCPU);
            
            this.lastCPUTime = now;
        }
    }
    
    /**
     * Update GPU metrics if extension is available
     */
    updateGPUMetrics() {
        // For now, estimate GPU load based on WebGL renderer activity
        // and texture memory usage
        if (window.app?.graphCanvas?.webglRenderer?.lodManager) {
            const lodManager = window.app.graphCanvas.webglRenderer.lodManager;
            const stats = lodManager.getStats();
            
            // Estimate GPU load based on texture memory usage and upload activity
            const memoryUsage = (stats.totalMemory / lodManager.maxTextureMemory) * 100;
            const uploadActivity = stats.queueLength * 5; // Each queued upload adds load
            
            const gpuLoad = Math.min(100, memoryUsage * 0.7 + uploadActivity * 0.3);
            
            this.gpuSamples.push(gpuLoad);
            if (this.gpuSamples.length > this.maxSamples) {
                this.gpuSamples.shift();
            }
            
            // Average the samples
            const avgGPU = this.gpuSamples.reduce((a, b) => a + b, 0) / this.gpuSamples.length;
            this.metrics.gpuTime = Math.round(avgGPU);
        } else {
            // No WebGL, estimate based on canvas operations
            const canvasLoad = this.metrics.avgFrameTime > 16 ? 50 : 20;
            this.metrics.gpuTime = canvasLoad;
        }
    }
    
    /**
     * Update memory usage metrics
     */
    updateMemoryMetrics() {
        if (performance.memory) {
            // Chrome provides memory info
            const used = performance.memory.usedJSHeapSize;
            const total = performance.memory.totalJSHeapSize;
            this.metrics.memoryUsage = Math.round((used / total) * 100);
        } else {
            // Estimate based on texture memory if available
            if (window.app?.graphCanvas?.webglRenderer?.lodManager) {
                const lodManager = window.app.graphCanvas.webglRenderer.lodManager;
                const stats = lodManager.getStats();
                // Convert to percentage of max allowed
                this.metrics.memoryUsage = Math.round((stats.totalMemory / lodManager.maxTextureMemory) * 100);
            }
        }
    }
    
    /**
     * Update quality level based on performance
     */
    updateQualityLevel(frameTime) {
        const currentThreshold = this.qualityThresholds[this.qualityLevel];
        
        if (frameTime > currentThreshold.target) {
            this.consecutiveBadFrames++;
            
            if (this.consecutiveBadFrames > currentThreshold.tolerance) {
                // Downgrade quality
                if (this.qualityLevel === 'high') {
                    this.qualityLevel = 'medium';
                    // 
                } else if (this.qualityLevel === 'medium') {
                    this.qualityLevel = 'low';
                    // 
                }
                this.consecutiveBadFrames = 0;
            }
        } else {
            // Good frame, slowly recover
            if (this.consecutiveBadFrames > 0) {
                this.consecutiveBadFrames--;
            }
            
            // Try to upgrade quality after sustained good performance
            if (this.consecutiveBadFrames === 0 && this.frameCount % 120 === 0) {
                if (this.qualityLevel === 'low' && this.metrics.avgFrameTime < 20) {
                    this.qualityLevel = 'medium';
                    // 
                } else if (this.qualityLevel === 'medium' && this.metrics.avgFrameTime < 12) {
                    this.qualityLevel = 'high';
                    // 
                }
            }
        }
    }
    
    /**
     * Get current quality settings
     */
    getQualitySettings() {
        switch (this.qualityLevel) {
            case 'low':
                return {
                    thumbnailOnly: true,
                    maxRenderDistance: 1, // Only render visible nodes
                    disableAnimations: true,
                    disableShadows: true
                };
            case 'medium':
                return {
                    thumbnailOnly: false,
                    maxRenderDistance: 1.5, // Render slightly beyond viewport
                    disableAnimations: false,
                    disableShadows: true
                };
            case 'high':
            default:
                return {
                    thumbnailOnly: false,
                    maxRenderDistance: 2, // Render well beyond viewport
                    disableAnimations: false,
                    disableShadows: false
                };
        }
    }
    
    /**
     * Get performance stats
     */
    getStats() {
        return {
            fps: this.fps,
            avgFrameTime: this.metrics.avgFrameTime.toFixed(1),
            maxFrameTime: this.metrics.maxFrameTime.toFixed(1),
            droppedFrames: this.metrics.droppedFrames,
            qualityLevel: this.qualityLevel,
            frameCount: this.frameCount
        };
    }
    
    /**
     * Reset all metrics
     */
    reset() {
        this.frameCount = 0;
        this.frameTimeHistory = [];
        this.metrics.droppedFrames = 0;
        this.consecutiveBadFrames = 0;
        this.qualityLevel = 'high';
    }
    
    /**
     * Draw performance HUD (for debugging)
     */
    drawHUD(ctx) {
        if (!this.showHUD || !this.enabled) return;
        
        const stats = this.getStats();
        const x = 10;
        let y = 70; // Start below other HUD elements
        
        ctx.save();
        
        // Background for better readability
        const lineHeight = 15;
        const numLines = 7; // Increased for new metrics
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x - 5, y - 12, 250, numLines * lineHeight + 10);
        
        // FPS
        ctx.font = '12px monospace';
        ctx.fillStyle = this.fps < 30 ? '#ff4444' : this.fps < 50 ? '#ffaa44' : '#44ff44';
        ctx.fillText(`FPS: ${stats.fps}`, x, y);
        
        // Frame time
        y += lineHeight;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`Frame: ${stats.avgFrameTime}ms (max: ${stats.maxFrameTime}ms)`, x, y);
        
        // CPU usage
        y += lineHeight;
        ctx.fillStyle = this.metrics.cpuUsage > 80 ? '#ff4444' : this.metrics.cpuUsage > 60 ? '#ffaa44' : '#44ff44';
        ctx.fillText(`CPU: ${this.metrics.cpuUsage}%`, x, y);
        
        // GPU usage
        y += lineHeight;
        ctx.fillStyle = this.metrics.gpuTime > 80 ? '#ff4444' : this.metrics.gpuTime > 60 ? '#ffaa44' : '#44ff44';
        ctx.fillText(`GPU: ${this.metrics.gpuTime}%`, x, y);
        
        // Memory usage
        y += lineHeight;
        ctx.fillStyle = this.metrics.memoryUsage > 80 ? '#ff4444' : this.metrics.memoryUsage > 60 ? '#ffaa44' : '#44ff44';
        ctx.fillText(`Memory: ${this.metrics.memoryUsage}%`, x, y);
        
        // Dropped frames
        y += lineHeight;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`Dropped: ${stats.droppedFrames}`, x, y);
        
        // Quality level
        y += lineHeight;
        ctx.fillStyle = stats.qualityLevel === 'low' ? '#ff4444' : stats.qualityLevel === 'medium' ? '#ffaa44' : '#44ff44';
        ctx.fillText(`Quality: ${stats.qualityLevel}`, x, y);
        
        // Draw CPU/GPU usage bars
        this.drawUsageBars(ctx, x + 180, 70);
        
        ctx.restore();
    }
    
    /**
     * Draw visual CPU/GPU usage bars
     */
    drawUsageBars(ctx, x, y) {
        const barWidth = 50;
        const barHeight = 8;
        const spacing = 12;
        
        // CPU bar
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(x, y, barWidth, barHeight);
        
        const cpuColor = this.metrics.cpuUsage > 80 ? '#ff4444' : this.metrics.cpuUsage > 60 ? '#ffaa44' : '#44ff44';
        ctx.fillStyle = cpuColor;
        ctx.fillRect(x, y, (this.metrics.cpuUsage / 100) * barWidth, barHeight);
        
        // GPU bar
        y += spacing;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(x, y, barWidth, barHeight);
        
        const gpuColor = this.metrics.gpuTime > 80 ? '#ff4444' : this.metrics.gpuTime > 60 ? '#ffaa44' : '#44ff44';
        ctx.fillStyle = gpuColor;
        ctx.fillRect(x, y, (this.metrics.gpuTime / 100) * barWidth, barHeight);
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.PerformanceMonitor = PerformanceMonitor;
}
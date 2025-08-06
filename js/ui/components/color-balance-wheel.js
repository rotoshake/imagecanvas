/**
 * Color Balance Wheel Component
 * Professional three-way color grading control
 */
class ColorBalanceWheel {
    constructor(canvas, range = 'midtones', onChange = () => {}, onChangeEnd = () => {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.size = canvas.width;
        this.centerX = this.size / 2;
        this.centerY = this.size / 2;
        this.range = range;
        this.onChange = onChange;
        this.onChangeEnd = onChangeEnd;
        
        // Ring dimensions - scale based on canvas size
        const scale = this.size / 200; // Original was designed for 200px
        this.wheelRadius = 72 * scale;
        this.innerRadius = this.wheelRadius + 3 * scale; // Small gap between wheel and ring
        this.outerRadius = this.innerRadius + 10 * scale; // 10 pixels wide
        
        // Control point
        this.controlX = 0;
        this.controlY = 0;
        
        // Luminance (can go beyond 0-1 range)
        this.luminanceValue = 0.5;
        this.luminanceRotations = 0; // Track total rotations
        this.ringRotation = 0; // Visual rotation of the ring
        
        this.setupEvents();
        this.draw();
    }
    
    setupEvents() {
        let isDragging = false;
        let isDraggingRing = false;
        let lastAngle = 0;
        let dragStartX = 0;
        let dragStartY = 0;
        let dragStartControlX = 0;
        let dragStartControlY = 0;
        
        this.canvas.addEventListener('mousedown', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left - this.centerX;
            const y = e.clientY - rect.top - this.centerY;
            const distance = Math.sqrt(x * x + y * y);
            
            if (distance >= this.innerRadius && distance <= this.outerRadius) {
                isDraggingRing = true;
                lastAngle = Math.atan2(y, x);
            } else if (distance <= this.wheelRadius) {
                isDragging = true;
                dragStartX = e.clientX;
                dragStartY = e.clientY;
                dragStartControlX = this.controlX;
                dragStartControlY = this.controlY;
            }
        });
        
        // Use document-level listeners for drag operations
        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                // Relative dragging with 0.1x speed for precision
                const deltaX = (e.clientX - dragStartX) * 0.1;
                const deltaY = (e.clientY - dragStartY) * 0.1;
                
                let newX = dragStartControlX + deltaX;
                let newY = dragStartControlY + deltaY;
                
                // Constrain to wheel
                const distance = Math.sqrt(newX * newX + newY * newY);
                if (distance > this.wheelRadius) {
                    const scale = this.wheelRadius / distance;
                    newX *= scale;
                    newY *= scale;
                }
                
                this.controlX = newX;
                this.controlY = newY;
                this.draw();
                this.notifyChange();
            } else if (isDraggingRing) {
                const rect = this.canvas.getBoundingClientRect();
                const x = e.clientX - rect.left - this.centerX;
                const y = e.clientY - rect.top - this.centerY;
                const angle = Math.atan2(y, x);
                
                let deltaAngle = angle - lastAngle;
                if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
                if (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;
                
                // 0.5x speed for ring
                const rotationDelta = deltaAngle * 0.5;
                this.ringRotation += rotationDelta;
                this.luminanceRotations += rotationDelta / (2 * Math.PI);
                
                // Update luminance value (can exceed 0-1 range)
                this.luminanceValue = 0.5 + this.luminanceRotations;
                
                lastAngle = angle;
                this.draw();
                this.notifyChange();
            }
        });
        
        document.addEventListener('mouseup', () => {
            const wasDragging = isDragging || isDraggingRing;
            isDragging = false;
            isDraggingRing = false;
            if (wasDragging) {
                this.onChangeEnd();
            }
        });
        
        // Double-click to reset
        this.canvas.addEventListener('dblclick', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left - this.centerX;
            const y = e.clientY - rect.top - this.centerY;
            const distance = Math.sqrt(x * x + y * y);
            
            if (distance >= this.innerRadius && distance <= this.outerRadius) {
                // Reset luminance
                this.luminanceValue = 0.5;
                this.luminanceRotations = 0;
                this.ringRotation = 0;
            } else if (distance <= this.wheelRadius) {
                // Reset color
                this.controlX = 0;
                this.controlY = 0;
            }
            this.draw();
            this.notifyChange();
            this.onChangeEnd();
        });
    }
    
    notifyChange() {
        // Convert control point to normalized values
        const x = this.controlX / this.wheelRadius;
        const y = this.controlY / this.wheelRadius;
        
        this.onChange({
            x: x,
            y: y,
            luminance: this.luminanceValue
        });
    }
    
    draw() {
        const ctx = this.ctx;
        
        // Clear
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, this.size, this.size);
        
        // Draw luminance ring with tick marks
        this.drawLuminanceRing();
        
        // Draw color wheel
        this.drawColorWheel();
        
        // Draw borders
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(this.centerX, this.centerY, this.outerRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(this.centerX, this.centerY, this.innerRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(this.centerX, this.centerY, this.wheelRadius, 0, Math.PI * 2);
        ctx.stroke();
        
        // Draw control point
        const x = this.centerX + this.controlX;
        const y = this.centerY + this.controlY;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
    }
    
    drawLuminanceRing() {
        const ctx = this.ctx;
        
        // Get background color based on luminance
        const bgColor = this.getIndicatorColor();
        
        // Background for ring with indicator color
        ctx.beginPath();
        ctx.arc(this.centerX, this.centerY, this.outerRadius, 0, Math.PI * 2);
        ctx.arc(this.centerX, this.centerY, this.innerRadius, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.fillStyle = bgColor;
        ctx.fill();
        
        // Draw tick marks with rotation
        const tickCount = 24; // Number of tick marks
        ctx.save();
        ctx.translate(this.centerX, this.centerY);
        ctx.rotate(this.ringRotation); // Apply visual rotation
        
        // Determine tick color based on background luminance
        const bgValue = this.getIndicatorValue();
        const tickColor = bgValue > 128 ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.3)';
        
        for (let i = 0; i < tickCount; i++) {
            const angle = (i / tickCount) * 2 * Math.PI;
            ctx.save();
            ctx.rotate(angle);
            
            // Tick mark
            ctx.strokeStyle = tickColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, this.innerRadius + 2);
            ctx.lineTo(0, this.outerRadius - 2);
            ctx.stroke();
            
            ctx.restore();
        }
        
        ctx.restore();
    }
    
    getIndicatorValue() {
        // Base colors for each range
        let baseValue;
        if (this.range === 'shadows') {
            baseValue = 0; // Black for lift
        } else if (this.range === 'midtones') {
            baseValue = 128; // Grey for gamma
        } else {
            baseValue = 255; // White for gain
        }
        
        // Adjust based on luminance value (no wrapping)
        const adjustment = (this.luminanceValue - 0.5) * 255;
        const finalValue = Math.max(0, Math.min(255, baseValue + adjustment));
        
        return finalValue;
    }
    
    getIndicatorColor() {
        const value = this.getIndicatorValue();
        return `rgb(${value}, ${value}, ${value})`;
    }
    
    drawColorWheel() {
        const ctx = this.ctx;
        
        ctx.save();
        ctx.beginPath();
        ctx.arc(this.centerX, this.centerY, this.wheelRadius, 0, Math.PI * 2);
        ctx.clip();
        
        // Use fewer segments to avoid moiré patterns on Windows
        // 60 segments provides smooth appearance without artifacts
        const segments = 60;
        
        // Pre-calculate segment angles for smoother rendering
        const segmentAngle = (2 * Math.PI) / segments;
        
        for (let i = 0; i < segments; i++) {
            const startAngle = i * segmentAngle;
            const endAngle = (i + 1) * segmentAngle;
            const midAngle = startAngle + segmentAngle / 2;
            
            // Convert canvas angle to vectorscope angle
            // Use middle of segment for color calculation to reduce edge artifacts
            let vectorscopeAngle = (90 - midAngle * 180 / Math.PI) % 360;
            if (vectorscopeAngle < 0) vectorscopeAngle += 360;
            
            // Create gradient for this segment
            const gradient = ctx.createRadialGradient(
                this.centerX, this.centerY, 0,
                this.centerX, this.centerY, this.wheelRadius
            );
            
            // Center color depends on wheel type
            let centerR, centerG, centerB;
            if (this.range === 'shadows') {
                // Shadows: center is black
                centerR = centerG = centerB = 0;
            } else if (this.range === 'highlights') {
                // Highlights: center is white
                centerR = centerG = centerB = 1;
            } else {
                // Midtones: center is gray
                centerR = centerG = centerB = 0.5;
            }
            gradient.addColorStop(0, `rgb(${centerR * 255}, ${centerG * 255}, ${centerB * 255})`);
            
            // Add intermediate stop for smoother gradients
            const intermediateRadius = 0.7;
            
            // Calculate intermediate color
            const angleRad = vectorscopeAngle * Math.PI / 180;
            const U_intermediate = Math.sin(angleRad) * 0.5 * intermediateRadius;
            const V_intermediate = -Math.cos(angleRad) * 0.5 * intermediateRadius;
            
            const Y_intermediate = 0.5;
            let R_intermediate = Y_intermediate + 1.14 * V_intermediate;
            let G_intermediate = Y_intermediate - 0.395 * U_intermediate - 0.581 * V_intermediate;
            let B_intermediate = Y_intermediate + 2.032 * U_intermediate;
            
            // Mix with center color based on range
            const mixFactor = 0.7;
            R_intermediate = centerR * (1 - mixFactor) + R_intermediate * mixFactor;
            G_intermediate = centerG * (1 - mixFactor) + G_intermediate * mixFactor;
            B_intermediate = centerB * (1 - mixFactor) + B_intermediate * mixFactor;
            
            R_intermediate = Math.max(0, Math.min(1, R_intermediate));
            G_intermediate = Math.max(0, Math.min(1, G_intermediate));
            B_intermediate = Math.max(0, Math.min(1, B_intermediate));
            
            gradient.addColorStop(0.7, `rgb(${R_intermediate * 255}, ${G_intermediate * 255}, ${B_intermediate * 255})`);
            
            // Edge color using YUV to RGB conversion
            const Y = 0.5;
            const U = Math.sin(angleRad) * 0.5;
            const V = -Math.cos(angleRad) * 0.5;
            
            // YUV to RGB conversion (ITU-R BT.601)
            let R = Y + 1.14 * V;
            let G = Y - 0.395 * U - 0.581 * V;
            let B = Y + 2.032 * U;
            
            // Clamp to valid range
            R = Math.max(0, Math.min(1, R));
            G = Math.max(0, Math.min(1, G));
            B = Math.max(0, Math.min(1, B));
            
            gradient.addColorStop(1, `rgb(${R * 255}, ${G * 255}, ${B * 255})`);
            
            // Draw segment with slight overlap to prevent gaps
            ctx.beginPath();
            ctx.moveTo(this.centerX, this.centerY);
            // Add tiny overlap to prevent rendering gaps between segments
            ctx.arc(this.centerX, this.centerY, this.wheelRadius, startAngle - 0.001, endAngle + 0.001);
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();
        }
        
        // Draw phase angle markers for SMPTE colors
        const smpteColors = [
            { angle: 103.7, color: 'Red', short: 'R' },
            { angle: 167.1, color: 'Yellow', short: 'Y' },
            { angle: 241.3, color: 'Green', short: 'G' },
            { angle: 283.7, color: 'Cyan', short: 'C' },
            { angle: 347.1, color: 'Blue', short: 'B' },
            { angle: 61.3, color: 'Magenta', short: 'M' }
        ];
        
        // Optional: draw small markers at SMPTE positions
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        smpteColors.forEach(smpte => {
            // Convert vectorscope angle to canvas angle
            const canvasAngle = (90 - smpte.angle) * Math.PI / 180;
            const x = this.centerX + Math.cos(canvasAngle) * (this.wheelRadius + 5);
            const y = this.centerY - Math.sin(canvasAngle) * (this.wheelRadius + 5);
            const x2 = this.centerX + Math.cos(canvasAngle) * (this.wheelRadius - 5);
            const y2 = this.centerY - Math.sin(canvasAngle) * (this.wheelRadius - 5);
            
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        });
        
        // Grid overlay
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(this.centerX - this.wheelRadius, this.centerY);
        ctx.lineTo(this.centerX + this.wheelRadius, this.centerY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(this.centerX, this.centerY - this.wheelRadius);
        ctx.lineTo(this.centerX, this.centerY + this.wheelRadius);
        ctx.stroke();
        
        ctx.restore();
    }
    
    reset() {
        this.controlX = 0;
        this.controlY = 0;
        this.luminanceValue = 0.5;
        this.luminanceRotations = 0;
        this.ringRotation = 0;
        this.draw();
        this.notifyChange();
    }
    
    setValue(x, y, luminance = null) {
        this.controlX = x * this.wheelRadius;
        this.controlY = y * this.wheelRadius;
        if (luminance !== null) {
            this.luminanceValue = luminance;
            this.luminanceRotations = luminance - 0.5;
            // Calculate visual rotation from luminance
            this.ringRotation = this.luminanceRotations * 2 * Math.PI;
        }
        this.draw();
    }
    
    getValue() {
        return {
            x: this.controlX / this.wheelRadius,
            y: this.controlY / this.wheelRadius,
            luminance: this.luminanceValue
        };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ColorBalanceWheel;
} else if (typeof window !== 'undefined') {
    window.ColorBalanceWheel = ColorBalanceWheel;
}
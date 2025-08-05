# Security Setup for LAN Access

## Current Security Measures

1. **Rate Limiting**: 100 requests per minute per IP
2. **Helmet.js**: Security headers (X-Frame-Options, X-Content-Type-Options, etc.)
3. **CORS**: Restricted to specific origins via environment variables
4. **Input Validation**: Using Joi for request validation

## Recommendations for Secure LAN Access

### 1. Use HTTPS (Recommended)
Generate a self-signed certificate for local development:
```bash
# In the server directory
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
```

### 2. Add Basic Authentication
For additional security on LAN, consider adding basic auth:
```javascript
// In .env
AUTH_USERNAME=admin
AUTH_PASSWORD=your-secure-password
```

### 3. Restrict Network Access
- Use Windows Firewall to limit which devices can connect
- Consider using a VPN for remote access instead of exposing to LAN

### 4. Monitor Access
The server logs all requests with timestamps. Monitor for unusual activity.

## Why Google Might Flag Activity

1. **Rapid API calls** during development/testing
2. **Unencrypted HTTP** traffic on non-standard ports
3. **WebSocket connections** from multiple IPs
4. **File uploads** triggering content scanning

## Quick Fixes

1. **Reduce polling frequency** in the client
2. **Use HTTPS** even for local development
3. **Limit CORS origins** to only necessary IPs
4. **Add user authentication** to prevent anonymous access
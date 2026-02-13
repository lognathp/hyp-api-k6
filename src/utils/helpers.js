/**
 * K6 Test Helpers
 * HYP Backend API - v2 (No Authentication Required)
 */

import http from 'k6/http';
import { check } from 'k6';
import { CONFIG } from '../config.js';

/**
 * Get standard headers (no auth needed for main branch)
 */
export function getHeaders() {
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };

    // Add restaurant ID if set (for scoped queries)
    if (CONFIG.RESTAURANT_ID) {
        headers['X-Restaurant-Id'] = CONFIG.RESTAURANT_ID;
    }

    return headers;
}
// Normalize dynamic IDs from URL
function normalizeEndpoint(endpoint) {
    return endpoint
        .replace(/\/\d+/g, '/:id')                // replace numeric IDs
        .replace(/[0-9a-fA-F-]{24,36}/g, ':uuid') // replace UUIDs
        .replace(/\?.*$/, '');                    // remove query params
}

// Generate stable metric name
function getEndpointName(method, endpoint) {
    const normalized = normalizeEndpoint(endpoint);
    return `${method.toLowerCase()}_${normalized}`;
}

/**
 * Make GET request
 */
export function apiGet(endpoint, params = {}) {
    const url = `${CONFIG.BASE_URL}${endpoint}`;
    const name = getEndpointName('GET', endpoint);

    const options = {
        headers: getHeaders(),
        timeout: CONFIG.REQUEST_TIMEOUT,
        tags: {
            name: name,
            ...(params.tags || {}),
        },
    };

    if (params.query) {
        const queryString = Object.entries(params.query)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&');
        return http.get(`${url}?${queryString}`, options);
    }

    return http.get(url, options);
}

/**
 * Make POST request
 */
export function apiPost(endpoint, body, params = {}) {
    const url = `${CONFIG.BASE_URL}${endpoint}`;
    const name = getEndpointName('POST', endpoint);

    return http.post(url, JSON.stringify(body), {
        headers: getHeaders(),
        timeout: CONFIG.REQUEST_TIMEOUT,
        tags: {
            name: name,
            ...(params.tags || {}),
        },
    });
}

/**
 * Make PATCH request
 */
export function apiPatch(endpoint, body, params = {}) {
    const url = `${CONFIG.BASE_URL}${endpoint}`;
    const name = getEndpointName('PATCH', endpoint);

    return http.patch(url, JSON.stringify(body), {
        headers: getHeaders(),
        timeout: CONFIG.REQUEST_TIMEOUT,
        tags: {
            name: name,
            ...(params.tags || {}),
        },
    });
}

/**
 * Make DELETE request
 */
export function apiDelete(endpoint, params = {}) {
    const url = `${CONFIG.BASE_URL}${endpoint}`;
    const name = getEndpointName('DELETE', endpoint);

    return http.del(url, null, {
        headers: getHeaders(),
        timeout: CONFIG.REQUEST_TIMEOUT,
        tags: {
            name: name,
            ...(params.tags || {}),
        },
    });
}
/**
 * Standard response check
 */
export function checkResponse(res, name, expectedStatus = 200) {
    return check(res, {
        [`${name} status is ${expectedStatus}`]: (r) => r.status === expectedStatus,
        [`${name} response time < 2s`]: (r) => r.timings.duration < 2000,
    });
}

/**
 * Check for successful JSON response with data
 */
export function checkJsonResponse(res, name) {
    return check(res, {
        [`${name} status is 200`]: (r) => r.status === 200,
        [`${name} is valid JSON`]: (r) => {
            try {
                JSON.parse(r.body);
                return true;
            } catch {
                return false;
            }
        },
        [`${name} has data field`]: (r) => {
            try {
                const body = JSON.parse(r.body);
                return body.data !== undefined;
            } catch {
                return false;
            }
        },
        [`${name} no error`]: (r) => {
            try {
                const body = JSON.parse(r.body);
                return body.error === false;
            } catch {
                return true;
            }
        },
    });
}

/**
 * Extract data from API response
 */
export function extractData(res) {
    try {
        const body = JSON.parse(res.body);
        return body.data;
    } catch {
        return null;
    }
}

/**
 * Extract ID from created resource
 * Handles both single object and array responses
 */
export function extractId(res) {
    try {
        const body = JSON.parse(res.body);
        // Handle array response (most common in this API)
        if (Array.isArray(body.data) && body.data.length > 0) {
            return body.data[0].id || body.data[0]._id;
        }
        // Handle single object response
        return body.data?.id || body.data?._id || body.id;
    } catch {
        return null;
    }
}

/**
 * Generate random string
 */
export function randomString(length = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Generate random phone (Indian format)
 */
export function randomPhone() {
    return `98${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`;
}

/**
 * Generate random email
 */
export function randomEmail() {
    return `loadtest_${randomString(6)}@test.com`;
}

/**
 * Generate random amount
 */
export function randomAmount(min = 100, max = 5000) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Random sleep duration in seconds
 */
export function randomSleep(minMs, maxMs) {
    return (Math.random() * (maxMs - minMs) + minMs) / 1000;
}

/**
 * Pick random item from array
 */
export function randomPick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

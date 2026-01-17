/**
 * Login Stress Test - Authentication Under Heavy Load
 *
 * Simulates heavy login traffic:
 * - Request OTP
 * - Verify OTP
 *
 * Uses fixed OTP (123456) when backend is in load test mode.
 *
 * Duration: ~5 minutes
 * VUs: Ramping 0 → 50 → 100 → 50 → 0
 *
 * Usage: ./run-tests.sh login-stress --restaurant 324672
 */

import { sleep, group, check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
import { CONFIG, ENDPOINTS, THRESHOLDS } from '../config.js';
import { apiPost, randomSleep } from '../utils/helpers.js';
import { generateLoginDto, generateVerifyOtpDto, generateUserPool, getUserFromPool } from '../data/test-data.js';

// Custom metrics
const loginSuccessRate = new Rate('login_success_rate');
const otpRequestTime = new Trend('otp_request_duration');
const otpVerifyTime = new Trend('otp_verify_duration');
const totalLoginTime = new Trend('total_login_duration');
const loginsCompleted = new Counter('logins_completed');
const loginsFailed = new Counter('logins_failed');

// Generate user pool
const userPool = generateUserPool(1000);

export const options = {
    scenarios: {
        login_stress: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 25 },   // Ramp up
                { duration: '1m', target: 50 },    // Increase
                { duration: '1m', target: 100 },   // Peak load
                { duration: '1m', target: 100 },   // Sustain peak
                { duration: '1m', target: 50 },    // Scale down
                { duration: '30s', target: 0 },    // Ramp down
            ],
        },
    },
    thresholds: {
        ...THRESHOLDS,
        'login_success_rate': ['rate>0.95'],
        'otp_request_duration': ['p(95)<2000'],
        'otp_verify_duration': ['p(95)<2000'],
        'total_login_duration': ['p(95)<4000'],
    },
};

export default function () {
    const restaurantId = CONFIG.RESTAURANT_ID;
    if (!restaurantId) {
        console.error('RESTAURANT_ID is required for login test');
        return;
    }

    // Get unique user for this VU
    const user = getUserFromPool(userPool, __VU);
    const flowStart = Date.now();
    let loginSuccess = false;
    let customerId = null;

    group('Login Flow', function () {
        // Step 1: Request OTP
        group('1. Request OTP', function () {
            const start = Date.now();
            const loginDto = generateLoginDto(user.name, user.mobile);
            const res = apiPost(ENDPOINTS.LOGIN_OTP, loginDto);

            otpRequestTime.add(Date.now() - start);

            const success = check(res, {
                'OTP request successful': (r) => r.status === 200,
            });

            if (!success) {
                console.warn(`OTP request failed for ${user.mobile}: ${res.status}`);
                loginsFailed.add(1);
                loginSuccessRate.add(0);
                return;
            }
        });

        sleep(randomSleep(200, 500));

        // Step 2: Verify OTP
        group('2. Verify OTP', function () {
            const start = Date.now();
            const verifyDto = generateVerifyOtpDto(user.mobile, restaurantId, CONFIG.LOAD_TEST_OTP);
            const res = apiPost(ENDPOINTS.LOGIN_VERIFY, verifyDto);

            otpVerifyTime.add(Date.now() - start);

            const isHttpOk = check(res, {
            'OTP verify HTTP 200': (r) => r.status === 200,
            }); 
            

if (isHttpOk) {
    try {
        const body = res.json();
        customerId = body?.data?.[0]?.id;

        if (customerId) {
            loginSuccess = true;
            loginsCompleted.add(1);
        } else {
            console.warn(`OTP verify: missing customerId`);
            loginsFailed.add(1);
        }
    } catch (e) {
        console.warn(`OTP verify: invalid JSON`);
        loginsFailed.add(1);
    }
} else {
    console.warn(`OTP verify failed for ${user.mobile}: ${res.status}`);
    loginsFailed.add(1);
}
        });
    });

    totalLoginTime.add(Date.now() - flowStart);
    loginSuccessRate.add(loginSuccess ? 1 : 0);

    sleep(randomSleep(500, 1500));
}

export function setup() {
    console.log('='.repeat(60));
    console.log('LOGIN STRESS TEST - Authentication Under Heavy Load');
    console.log('='.repeat(60));
    console.log(`Target: ${CONFIG.BASE_URL}`);
    console.log(`Restaurant: ${CONFIG.RESTAURANT_ID || 'NOT SET!'}`);
    console.log(`Fixed OTP: ${CONFIG.LOAD_TEST_OTP}`);
    console.log(`User Pool: ${userPool.length} users`);
    console.log('Load Pattern: 0 → 50 → 100 → 50 → 0 VUs');
    console.log('Duration: ~5 minutes');
    console.log('='.repeat(60));

    if (!CONFIG.RESTAURANT_ID) {
        throw new Error('RESTAURANT_ID is required! Use --env RESTAURANT_ID=xxx');
    }

    return { startTime: Date.now() };
}

export function teardown(data) {
    const duration = (Date.now() - data.startTime) / 1000 / 60;
    console.log(`\nLogin stress test completed in ${duration.toFixed(1)} minutes`);
}

export function handleSummary(data) {
    return {
        'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    };
}

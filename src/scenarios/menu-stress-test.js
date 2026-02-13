/**
 * Menu Stress Test - Menu Browsing Under Heavy Load
 *
 * Simulates heavy menu browsing:
 * - Fetch categories
 * - Fetch items
 * - Fetch addons
 * - Fetch variations
 * - View specific items
 *
 * Modes:
 * - sanity: Single user, quick validation (~1 min)
 * - load:   Multiple users, full stress test (~5 min)
 *
 * Usage:
 *   ./run-tests.sh menu-stress --restaurant 324672 --mode sanity  # Quick validation
 *   ./run-tests.sh menu-stress --restaurant 324672                # Full stress test
 */

import { sleep, group, check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
import { CONFIG, ENDPOINTS, THRESHOLDS } from '../config.js';
import { apiGet, randomSleep } from '../utils/helpers.js';

// Custom metrics
const menuFetchTime = new Trend('menu_fetch_duration');
const categoryFetchTime = new Trend('category_fetch_duration');
const itemFetchTime = new Trend('item_fetch_duration');
const addonFetchTime = new Trend('addon_fetch_duration');
const menuSuccessRate = new Rate('menu_success_rate');
const menuRequests = new Counter('menu_requests');

// Check if sanity mode
const isSanityMode = CONFIG.USER_MODE === 'sanity';

// Scenario configurations
const sanityScenario = {
    executor: 'per-vu-iterations',
    vus: 1,
    iterations: 5,  // Test each menu operation once
    maxDuration: '2m',
};

const stressScenario = {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
        { duration: '30s', target: 50 },   // Ramp up
        { duration: '1m', target: 75 },    // Increase
        { duration: '1m', target: 90 },    // Peak load
        { duration: '1m', target: 100 },   // Sustain peak
        { duration: '1m', target: 90 },    // Scale down
        { duration: '30s', target: 0 },    // Ramp down
    ],
};

export const options = {
    scenarios: {
        menu_stress: isSanityMode ? sanityScenario : stressScenario,
    },
    thresholds: {
        ...THRESHOLDS,
        'menu_success_rate': ['rate>0.95'],
        'menu_fetch_duration': ['p(95)<2000'],
        'category_fetch_duration': ['p(95)<1500'],
        'item_fetch_duration': ['p(95)<1500'],
    },
};

export default function () {
    const restaurantId = CONFIG.RESTAURANT_ID;

    // Simulate user browsing behavior
    const action = Math.random();

    if (action < 0.3) {
        // 30% - Full menu fetch (categories with items)
        fetchFullMenu(restaurantId);
    } else if (action < 0.5) {
        // 20% - Browse categories only
        fetchCategories();
    } else if (action < 0.7) {
        // 20% - Browse items
        fetchItems();
    } else if (action < 0.85) {
        // 15% - Browse addons
        fetchAddons();
    } else {
        // 15% - Browse variations
        fetchVariations();
    }

    sleep(randomSleep(300, 1000));
}

function fetchFullMenu(restaurantId) {
    group('Full Menu Fetch', function () {
        if (!restaurantId) {
            console.warn('RESTAURANT_ID not set, skipping full menu fetch');
            return;
        }

        const start = Date.now();
        const res = apiGet(ENDPOINTS.MENU_CATEGORY(restaurantId));
        const duration = Date.now() - start;

        menuFetchTime.add(duration);
        menuRequests.add(1);

        const success = check(res, {
            'Menu fetch status 200': (r) => r.status === 200,
            'Menu fetch < 2s': (r) => r.timings.duration < 2000,
        });

        menuSuccessRate.add(success ? 1 : 0);

        if (!success) {
            console.warn(`Menu fetch failed: ${res.status}`);
        }
    });
}

function fetchCategories() {
    group('Category Fetch', function () {
        const start = Date.now();
        const res = apiGet(ENDPOINTS.CATEGORY_LIST);
        const duration = Date.now() - start;

        categoryFetchTime.add(duration);
        menuRequests.add(1);

        const success = check(res, {
            'Category fetch status 200': (r) => r.status === 200,
        });

        menuSuccessRate.add(success ? 1 : 0);
    });
}

function fetchItems() {
    group('Item Fetch', function () {
        const start = Date.now();
        const res = apiGet(ENDPOINTS.ITEM_LIST);
        const duration = Date.now() - start;

        itemFetchTime.add(duration);
        menuRequests.add(1);

        const success = check(res, {
            'Item fetch status 200': (r) => r.status === 200,
        });

        menuSuccessRate.add(success ? 1 : 0);
    });
}

function fetchAddons() {
    group('Addon Fetch', function () {
        const start = Date.now();
        const res = apiGet(ENDPOINTS.ADDON_GROUP_LIST);
        const duration = Date.now() - start;

        addonFetchTime.add(duration);
        menuRequests.add(1);

        const success = check(res, {
            'Addon fetch status 200': (r) => r.status === 200,
        });

        menuSuccessRate.add(success ? 1 : 0);

        // Also fetch addon items
        sleep(randomSleep(100, 300));
        apiGet(ENDPOINTS.ADDON_GROUP_ITEMS);
        menuRequests.add(1);
    });
}

function fetchVariations() {
    group('Variation Fetch', function () {
        const res = apiGet(ENDPOINTS.VARIATION_LIST);
        menuRequests.add(1);

        const success = check(res, {
            'Variation fetch status 200': (r) => r.status === 200,
        });

        menuSuccessRate.add(success ? 1 : 0);
    });
}

export function setup() {
    console.log('='.repeat(60));
    console.log(`MENU STRESS TEST - ${isSanityMode ? 'SANITY MODE' : 'STRESS TEST'}`);
    console.log('='.repeat(60));
    console.log(`Target: ${CONFIG.BASE_URL}`);
    console.log(`Restaurant: ${CONFIG.RESTAURANT_ID || 'Not set (will skip full menu)'}`);
    console.log(`Mode: ${isSanityMode ? 'sanity (single user validation)' : 'stress (multi-user)'}`);
    if (isSanityMode) {
        console.log('VUs: 1, Iterations: 5');
        console.log('Duration: ~1 minute');
    } else {
        console.log('Load Pattern: 0 → 50 → 75 → 100 → 90 → 0 VUs');
        console.log('Duration: ~5 minutes');
    }
    console.log('='.repeat(60));

    return { startTime: Date.now() };
}

export function teardown(data) {
    const duration = (Date.now() - data.startTime) / 1000 / 60;
    console.log(`\nMenu stress test completed in ${duration.toFixed(1)} minutes`);
}

export function handleSummary(data) {
    return {
        'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    };
}

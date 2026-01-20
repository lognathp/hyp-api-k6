/**
 * Dynamic Test Data Fetching
 * HYP Backend API - Load Testing
 *
 * Fetches menu items, taxes, and customer data dynamically from the API
 * based on restaurant ID instead of using hardcoded values.
 *
 * Usage:
 *   import { fetchMenuData, fetchCustomerAddresses } from './data/dynamic-data.js';
 *
 *   export function setup() {
 *       const menuData = fetchMenuData(restaurantId);
 *       return { menuData };
 *   }
 *
 *   export default function(data) {
 *       const order = generateDynamicOrderDto(restaurantId, customerId, data.menuData);
 *   }
 */

import http from 'k6/http';
import { check } from 'k6';
import { CONFIG, ENDPOINTS } from '../config.js';

/**
 * Fetch restaurant details including location
 * @param {string} restaurantId - Restaurant ID
 * @returns {object} { id, name, location: { latitude, longitude } }
 */
export function fetchRestaurantLocation(restaurantId) {
    const url = `${CONFIG.BASE_URL}${ENDPOINTS.RESTAURANT_GET(restaurantId)}`;
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };

    console.log(`Fetching restaurant location for: ${restaurantId}`);
    const res = http.get(url, { headers, timeout: CONFIG.REQUEST_TIMEOUT });

    if (res.status !== 200) {
        console.warn(`Failed to fetch restaurant: ${res.status}`);
        return null;
    }

    try {
        const body = JSON.parse(res.body);
        const restaurant = body.data?.[0] || body.data;

        if (!restaurant) {
            console.warn('Restaurant data not found');
            return null;
        }

        // Extract location from restaurant
        const location = restaurant.location || restaurant.address?.location || {
            latitude: restaurant.latitude,
            longitude: restaurant.longitude,
        };

        console.log(`Restaurant location: ${JSON.stringify(location)}`);

        return {
            id: restaurant.id || restaurant._id,
            name: restaurant.name || restaurant.restaurantName,
            location: location,
        };
    } catch (e) {
        console.error(`Failed to parse restaurant data: ${e.message}`);
        return null;
    }
}

/**
 * Fetch menu categories with items from API
 * Returns structured data: { categories, items, taxes }
 */
export function fetchMenuData(restaurantId) {
    const url = `${CONFIG.BASE_URL}${ENDPOINTS.MENU_CATEGORY(restaurantId)}`;
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };

    console.log(`Fetching menu data from: ${url}`);
    const res = http.get(url, { headers, timeout: CONFIG.REQUEST_TIMEOUT });

    const success = check(res, {
        'Menu data fetched': (r) => r.status === 200,
        'Menu data is valid JSON': (r) => {
            try {
                JSON.parse(r.body);
                return true;
            } catch {
                return false;
            }
        },
    });

    if (!success) {
        console.error(`Failed to fetch menu data: ${res.status} - ${res.body}`);
        return null;
    }

    try {
        const body = JSON.parse(res.body);
        const categories = body.data || [];
        return parseMenuData(categories);
    } catch (e) {
        console.error(`Failed to parse menu data: ${e.message}`);
        return null;
    }
}

/**
 * Parse menu categories and extract items with taxes
 */
function parseMenuData(categories) {
    const items = [];
    const taxMap = new Map();

    for (const category of categories) {
        if (!category.items || !Array.isArray(category.items)) {
            continue;
        }

        for (const item of category.items) {
            // Skip items without price or that are unavailable
            if (!item.price || item.price <= 0) {
                continue;
            }

            const itemData = {
                id: item.id || item._id,
                name: item.itemName || item.name,
                description: item.description || '',
                price: parseFloat(item.price),
                categoryId: category.id || category._id,
                categoryName: category.name,
                taxes: [],
            };

            // Extract taxes from item
            if (item.taxes && Array.isArray(item.taxes)) {
                for (const tax of item.taxes) {
                    const taxData = {
                        id: tax.id || tax._id,
                        name: tax.taxName || tax.name,
                        rate: parseFloat(tax.tax || tax.rate || 0),
                        type: tax.taxType || tax.type || '1',
                    };
                    itemData.taxes.push(taxData);

                    // Store unique taxes
                    if (!taxMap.has(taxData.id)) {
                        taxMap.set(taxData.id, taxData);
                    }
                }
            }

            items.push(itemData);
        }
    }

    const result = {
        categories: categories.map(c => ({
            id: c.id || c._id,
            name: c.name,
            itemCount: c.items ? c.items.length : 0,
        })),
        items: items,
        taxes: Array.from(taxMap.values()),
        itemCount: items.length,
        categoryCount: categories.length,
    };

    console.log(`Loaded ${result.itemCount} items from ${result.categoryCount} categories`);
    console.log(`Found ${result.taxes.length} unique tax types`);

    return result;
}

/**
 * Fetch customer addresses
 */
export function fetchCustomerAddresses(customerId) {
    const url = `${CONFIG.BASE_URL}/address?customerId=${customerId}`;
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };

    console.log(`Fetching addresses for customer: ${customerId}`);
    const res = http.get(url, { headers, timeout: CONFIG.REQUEST_TIMEOUT });

    if (res.status !== 200) {
        console.warn(`Failed to fetch addresses: ${res.status}`);
        return [];
    }

    try {
        const body = JSON.parse(res.body);
        const addresses = body.data || [];
        console.log(`Loaded ${addresses.length} addresses`);
        return addresses.map(a => ({
            id: a.id || a._id,
            addressType: a.addressType,
            isDefault: a.isDefault,
        }));
    } catch (e) {
        console.error(`Failed to parse addresses: ${e.message}`);
        return [];
    }
}

/**
 * Get random items from menu data
 */
export function getRandomItems(menuData, count = 2) {
    if (!menuData || !menuData.items || menuData.items.length === 0) {
        return [];
    }

    const items = [];
    const availableItems = [...menuData.items];

    for (let i = 0; i < count && availableItems.length > 0; i++) {
        const index = Math.floor(Math.random() * availableItems.length);
        items.push(availableItems.splice(index, 1)[0]);
    }

    return items;
}

/**
 * Generate order DTO using dynamic menu data
 */
export function generateDynamicOrderDto(restaurantId, customerId, menuData, options = {}) {
    const itemCount = options.itemCount || Math.floor(Math.random() * 2) + 1;
    const selectedItems = getRandomItems(menuData, itemCount);

    if (selectedItems.length === 0) {
        console.error('No items available to create order');
        return null;
    }

    const orderItems = [];
    let subtotal = 0;
    const taxTotals = new Map();

    // Build order items with calculated taxes
    for (const item of selectedItems) {
        const quantity = Math.floor(Math.random() * 2) + 1;
        const finalPrice = item.price * quantity;
        subtotal += finalPrice;

        const orderItemTax = [];

        // Calculate taxes for this item
        for (const tax of item.taxes) {
            const taxAmount = (finalPrice * tax.rate) / 100;
            orderItemTax.push({
                id: tax.id,
                name: tax.name,
                amount: parseFloat(taxAmount.toFixed(2)),
            });

            // Accumulate tax totals
            const currentTotal = taxTotals.get(tax.id) || { ...tax, total: 0 };
            currentTotal.total += taxAmount;
            taxTotals.set(tax.id, currentTotal);
        }

        orderItems.push({
            id: item.id,
            name: item.name,
            description: item.description,
            itemDiscount: 0,
            finalPrice: finalPrice,
            quantity: quantity,
            price: item.price,
            orderItemTax: orderItemTax,
        });
    }

    // Build order tax array
    const orderTax = Array.from(taxTotals.values()).map(tax => ({
        id: tax.id,
        title: tax.name,
        type: tax.type,
        price: tax.rate,
        tax: parseFloat(tax.total.toFixed(2)),
        restaurantLiableAmt: parseFloat(tax.total.toFixed(2)),
    }));

    const taxAmount = Array.from(taxTotals.values()).reduce((sum, t) => sum + t.total, 0);
    const deliveryCharge = options.orderType === '2' ? 0 : 53.1; // No delivery for pickup
    const packagingCharge = 20;
    const grandTotal = subtotal + taxAmount + deliveryCharge + packagingCharge;

    const now = new Date();
    const deliveryTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now

    // Use provided addressId or default
    const addressId = options.addressId || '106335';

    return {
        restaurantId: restaurantId,
        customerId: customerId,
        orderType: options.orderType || '1', // Default: DELIVERY
        paymentType: options.paymentType || 'CREDIT',
        description: 'Order + Tax',
        orderItems: orderItems,
        orderTax: orderTax,
        deliveryDetails: {
            addressId: addressId,
            service: 'wefast',
            pickupNow: true,
            networkId: 18,
        },
        specialInstructions: options.specialInstructions || 'Load test order',
        orderTime: now.toISOString(),
        expectedDeliveryTime: deliveryTime.toISOString(),
        totalAmount: parseFloat(grandTotal.toFixed(2)),
        discountAmount: 0.0,
        taxAmount: parseFloat(taxAmount.toFixed(2)),
        deliveryCharge: deliveryCharge,
        dcTaxAmount: 0,
        packagingCharge: packagingCharge,
        pcTaxAmount: 0.0,
        serviceCharge: 0.0,
        scTaxAmount: 0.0,
        grandTotalAmount: parseFloat(grandTotal.toFixed(2)),
    };
}

/**
 * Validate menu data is usable
 */
export function validateMenuData(menuData) {
    if (!menuData) {
        return { valid: false, error: 'Menu data is null' };
    }
    if (!menuData.items || menuData.items.length === 0) {
        return { valid: false, error: 'No items found in menu' };
    }
    if (menuData.items.length < 2) {
        return { valid: false, error: 'Need at least 2 items for varied orders' };
    }

    // Check if items have required fields
    const validItems = menuData.items.filter(i => i.id && i.price > 0);
    if (validItems.length === 0) {
        return { valid: false, error: 'No valid items with price found' };
    }

    return { valid: true, itemCount: validItems.length };
}

/**
 * Print menu data summary
 */
export function printMenuSummary(menuData) {
    if (!menuData) {
        console.log('No menu data available');
        return;
    }

    console.log('\n--- Menu Data Summary ---');
    console.log(`Categories: ${menuData.categoryCount}`);
    console.log(`Items: ${menuData.itemCount}`);
    console.log(`Tax Types: ${menuData.taxes.length}`);

    if (menuData.taxes.length > 0) {
        console.log('Taxes:');
        for (const tax of menuData.taxes) {
            console.log(`  - ${tax.name}: ${tax.rate}%`);
        }
    }

    if (menuData.items.length > 0) {
        console.log('Sample items:');
        const samples = menuData.items.slice(0, 3);
        for (const item of samples) {
            console.log(`  - ${item.name}: Rs.${item.price}`);
        }
    }
    console.log('-------------------------\n');
}

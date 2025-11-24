import { runAuditComparison } from './audit';
import { Product } from '@/lib/types';

// Mock the shopify library to avoid initialization errors
jest.mock('@/lib/shopify', () => ({
    getShopifyProductsBySku: jest.fn(),
    getFullProduct: jest.fn(),
}));

describe('Audit Location Logic', () => {
    const mockShopifyProduct: Product = {
        id: 'gid://shopify/Product/1',
        variantId: 'gid://shopify/ProductVariant/1',
        inventoryItemId: 'gid://shopify/InventoryItem/1',
        handle: 'test-handle',
        sku: 'sku-1',
        name: 'Test Product',
        price: 10,
        inventory: 5,
        descriptionHtml: '',
        productType: 'T-Shirt',
        vendor: 'Test Vendor',
        tags: '',
        compareAtPrice: null,
        costPerItem: null,
        barcode: null,
        weight: 100,
        mediaUrl: null,
        category: null,
        imageId: null,
        option1Name: 'Size',
        option1Value: 'M',
        option2Name: null,
        option2Value: null,
        option3Name: null,
        option3Value: null,
        templateSuffix: null,
        locationIds: [], // Default empty
    };

    it('should report mismatches for normal products', async () => {
        const csvProduct: Product = {
            ...mockShopifyProduct,
            price: 20, // Price mismatch
        };

        const { report } = await runAuditComparison([csvProduct], [mockShopifyProduct], 'test.csv');

        const item = report.find(r => r.sku === 'sku-1');
        expect(item).toBeDefined();
        expect(item!.status).toBe('mismatched');
        expect(item!.mismatches).toHaveLength(1);
        expect(item!.mismatches[0].field).toBe('price');
    });

    it('should IGNORE mismatches if product is in Garage Harry Stanley location', async () => {
        const garageLocationId = 'gid://shopify/Location/86376317245';
        const shopifyProductInGarage: Product = {
            ...mockShopifyProduct,
            locationIds: [garageLocationId],
        };

        const csvProduct: Product = {
            ...shopifyProductInGarage,
            price: 20, // Price mismatch that should be IGNORED
        };

        const { report } = await runAuditComparison([csvProduct], [shopifyProductInGarage], 'test.csv');

        const item = report.find(r => r.sku === 'sku-1');
        expect(item).toBeDefined();
        // Should be 'matched' because mismatches are ignored (returned as empty array)
        expect(item!.status).toBe('matched');
        expect(item!.mismatches).toHaveLength(0);
    });
});

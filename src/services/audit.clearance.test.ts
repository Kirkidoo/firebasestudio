import { runAuditComparison } from './audit';
import { Product } from '@/lib/types';

// Mock the shopify library to avoid initialization errors
jest.mock('@/lib/shopify', () => ({
    getShopifyProductsBySku: jest.fn(),
    getFullProduct: jest.fn(),
}));

describe('Audit Service - Clearance Logic', () => {
    const mockCsvProduct: Product = {
        id: '',
        variantId: '',
        inventoryItemId: '',
        handle: 'test-product',
        sku: 'TEST-SKU',
        name: 'Test Product',
        price: 20.0,
        inventory: 10,
        descriptionHtml: '<p>Description</p>',
        productType: 'Type',
        vendor: 'Vendor',
        tags: 'tag1',
        compareAtPrice: null,
        costPerItem: 10.0,
        barcode: null,
        weight: 1000,
        mediaUrl: null,
        category: null,
        option1Name: null,
        option1Value: null,
        option2Name: null,
        option2Value: null,
        option3Name: null,
        option3Value: null,
        imageId: null,
        templateSuffix: null,
    };

    const mockShopifyProduct: Product = {
        ...mockCsvProduct,
        id: 'gid://shopify/Product/123',
        variantId: 'gid://shopify/ProductVariant/456',
        inventoryItemId: 'gid://shopify/InventoryItem/789',
        tags: 'tag1', // Missing 'Clearance' tag
    };

    it('should flag missing clearance tag when file is Clearance.csv', async () => {
        const result = await runAuditComparison([mockCsvProduct], [mockShopifyProduct], 'Clearance.csv');

        expect(result.report[0].status).toBe('mismatched');
        expect(result.report[0].mismatches).toContainEqual(
            expect.objectContaining({ field: 'missing_clearance_tag' })
        );
    });

    it('should NOT flag missing clearance tag when file is NOT Clearance.csv', async () => {
        const result = await runAuditComparison([mockCsvProduct], [mockShopifyProduct], 'Regular.csv');

        expect(result.report[0].status).toBe('matched');
    });

    it('should match if clearance tag is present in Shopify product', async () => {
        const clearanceShopifyProduct = { ...mockShopifyProduct, tags: 'tag1, Clearance', templateSuffix: 'clearance' };
        const result = await runAuditComparison([mockCsvProduct], [clearanceShopifyProduct], 'Clearance.csv');

        expect(result.report[0].status).toBe('matched');
    });

    it('should report missing_in_shopify if product is not in Shopify (Clearance file)', async () => {
        const result = await runAuditComparison([mockCsvProduct], [], 'Clearance.csv');

        expect(result.summary.missing_in_shopify).toBe(1);
        expect(result.report[0].status).toBe('missing_in_shopify');
        expect(result.report[0].mismatches).toHaveLength(1);
        expect(result.report[0].mismatches[0].field).toBe('missing_in_shopify');
    });

    it('should flag missing clearance tag even if product has NO tags', async () => {
        const noTagsShopifyProduct = { ...mockShopifyProduct, tags: '' };
        const result = await runAuditComparison([mockCsvProduct], [noTagsShopifyProduct], 'Clearance.csv');

        expect(result.report[0].status).toBe('mismatched');
        expect(result.report[0].mismatches).toContainEqual(
            expect.objectContaining({ field: 'missing_clearance_tag' })
        );
    });
    it('should flag invalid clearance product (Price == Compare At Price)', async () => {
        const invalidClearanceProduct = {
            ...mockCsvProduct,
            price: 20.0,
            compareAtPrice: 20.0
        };
        const result = await runAuditComparison([invalidClearanceProduct], [mockShopifyProduct], 'Clearance.csv');

        expect(result.report[0].status).toBe('mismatched');
        expect(result.report[0].mismatches).toContainEqual(
            expect.objectContaining({ field: 'clearance_price_mismatch' })
        );
    });
});

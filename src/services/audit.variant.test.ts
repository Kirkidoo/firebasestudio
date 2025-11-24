import { runAuditComparison } from './audit';
import { Product } from '@/lib/types';

// Mock the shopify library to avoid initialization errors
jest.mock('@/lib/shopify', () => ({
    getShopifyProductsBySku: jest.fn(),
    getFullProduct: jest.fn(),
}));

describe('Audit Variant Detection Logic', () => {
    const mockShopifyProduct: Product = {
        id: 'gid://shopify/Product/1',
        variantId: 'gid://shopify/ProductVariant/1',
        inventoryItemId: 'gid://shopify/InventoryItem/1',
        handle: 'test-handle',
        sku: 'sku-1',
        name: 'Original Title',
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
    };

    it('should detect Missing Variant when handle exists and titles match', async () => {
        const csvProduct: Product = {
            ...mockShopifyProduct,
            sku: 'sku-2', // Different SKU
            name: 'Original Title', // Same Title
            handle: 'test-handle', // Same Handle
            id: '',
            variantId: '',
            inventoryItemId: '',
        };

        const { report } = await runAuditComparison([csvProduct], [mockShopifyProduct], 'test.csv');

        const item = report.find(r => r.sku === 'sku-2');
        expect(item).toBeDefined();
        expect(item!.status).toBe('missing_in_shopify');
        expect(item!.mismatches[0].missingType).toBe('variant');
        expect(item!.mismatches[0].field).toBe('missing_in_shopify');
    });

    it('should detect Missing Variant (ignoring title mismatch) when handle exists but titles differ', async () => {
        const csvProduct: Product = {
            ...mockShopifyProduct,
            sku: 'sku-2', // Different SKU
            name: 'Different Title', // Different Title
            handle: 'test-handle', // Same Handle
            id: '',
            variantId: '',
            inventoryItemId: '',
        };

        const { report } = await runAuditComparison([csvProduct], [mockShopifyProduct], 'test.csv');

        const item = report.find(r => r.sku === 'sku-2');
        expect(item).toBeDefined();
        expect(item!.status).toBe('missing_in_shopify');
        expect(item!.mismatches[0].field).toBe('missing_in_shopify');
        expect(item!.mismatches[0].missingType).toBe('variant');
    });

    it('should detect Missing Product when handle does not exist', async () => {
        const csvProduct: Product = {
            ...mockShopifyProduct,
            sku: 'sku-new',
            handle: 'new-handle',
            name: 'New Product',
            id: '',
            variantId: '',
            inventoryItemId: '',
        };

        const { report } = await runAuditComparison([csvProduct], [mockShopifyProduct], 'test.csv');

        const item = report.find(r => r.sku === 'sku-new');
        expect(item).toBeDefined();
        expect(item!.status).toBe('missing_in_shopify');
        expect(item!.mismatches[0].missingType).toBe('product');
    });
});

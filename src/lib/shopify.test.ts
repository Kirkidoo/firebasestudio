import { getShopifyProductsBySku } from './shopify';

// Mock the shopify-api library
const mockQuery = jest.fn();
jest.mock('@shopify/shopify-api', () => ({
    shopifyApi: jest.fn(() => ({
        clients: {
            Graphql: jest.fn(() => ({
                query: mockQuery,
            })),
        },
    })),
    LATEST_API_VERSION: '2024-01',
    Session: jest.fn(),
}));

describe('getShopifyProductsBySku', () => {
    beforeEach(() => {
        mockQuery.mockReset();
        process.env.SHOPIFY_SHOP_NAME = 'test-shop';
        process.env.SHOPIFY_API_ACCESS_TOKEN = 'test-token';
    });

    it('should verify and recover a missing SKU', async () => {
        const skusToFetch = ['SKU_FOUND', 'SKU_MISSING_INITIALLY'];

        // Mock responses
        mockQuery
            // First call: Batch query (misses SKU_MISSING_INITIALLY)
            .mockResolvedValueOnce({
                body: {
                    data: {
                        productVariants: {
                            edges: [
                                {
                                    node: {
                                        id: 'gid://shopify/ProductVariant/1',
                                        sku: 'SKU_FOUND',
                                        price: '10.00',
                                        inventoryQuantity: 5,
                                        product: {
                                            id: 'gid://shopify/Product/1',
                                            title: 'Found Product',
                                            handle: 'found-product',
                                            bodyHtml: '',
                                            tags: [],
                                            featuredImage: { url: 'http://example.com/img.jpg' },
                                        },
                                    },
                                },
                            ],
                        },
                    },
                },
            })
            // Second call: Verification query for SKU_MISSING_INITIALLY (finds it)
            .mockResolvedValueOnce({
                body: {
                    data: {
                        productVariants: {
                            edges: [
                                {
                                    node: {
                                        id: 'gid://shopify/ProductVariant/2',
                                        sku: 'SKU_MISSING_INITIALLY',
                                        price: '20.00',
                                        inventoryQuantity: 0,
                                        product: {
                                            id: 'gid://shopify/Product/2',
                                            title: 'Recovered Product',
                                            handle: 'recovered-product',
                                            bodyHtml: '',
                                            tags: [],
                                            featuredImage: null,
                                        },
                                    },
                                },
                            ],
                        },
                    },
                },
            });

        const results = await getShopifyProductsBySku(skusToFetch);

        expect(results).toHaveLength(2);
        expect(results.find((p) => p.sku === 'SKU_FOUND')).toBeDefined();
        expect(results.find((p) => p.sku === 'SKU_MISSING_INITIALLY')).toBeDefined();
        expect(mockQuery).toHaveBeenCalledTimes(2);
    });
});

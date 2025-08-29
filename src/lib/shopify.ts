'use server';

import { shopifyApi, LATEST_API_VERSION, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import { Product } from '@/lib/types';

// Helper function to introduce a delay
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const GET_PRODUCTS_BY_SKU_QUERY = `
  query getProductsBySku($query: String!) {
    products(first: 250, query: $query) {
      edges {
        node {
          id
          title
          handle
          bodyHtml
          variants(first: 10) {
            edges {
              node {
                id
                sku
                price
                inventoryQuantity
                inventoryItem {
                    id
                }
              }
            }
          }
        }
      }
    }
  }
`;

const UPDATE_PRODUCT_MUTATION = `
    mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
            product {
                id
            }
            userErrors {
                field
                message
            }
        }
    }
`;

const UPDATE_PRODUCT_VARIANT_MUTATION = `
    mutation productVariantUpdate($input: ProductVariantInput!) {
        productVariantUpdate(input: $input) {
            productVariant {
                id
            }
            userErrors {
                field
                message
            }
        }
    }
`;

const UPDATE_INVENTORY_LEVEL_MUTATION = `
    mutation inventorySetOnHandQuantities($input: InventorySetOnHandQuantitiesInput!) {
        inventorySetOnHandQuantities(input: $input) {
            inventoryAdjustmentGroup {
                id
            }
            userErrors {
                field
                message
            }
        }
    }
`;


function getShopifyClient() {
     if (!process.env.SHOPIFY_SHOP_NAME || !process.env.SHOPIFY_API_ACCESS_TOKEN) {
        console.error("Shopify environment variables are not set.");
        throw new Error("Shopify environment variables are not set. Please create a .env.local file.");
    }
    
    const shopify = shopifyApi({
      apiKey: 'dummy',
      apiSecretKey: 'dummy',
      scopes: ['read_products', 'write_products', 'read_inventory', 'write_inventory'],
      hostName: 'dummy.ngrok.io',
      apiVersion: LATEST_API_VERSION,
      isEmbeddedApp: false,
      maxRetries: 3,
    });

    const session = new Session({
      shop: process.env.SHOPIFY_SHOP_NAME!,
      accessToken: process.env.SHOPIFY_API_ACCESS_TOKEN!,
      isOnline: false,
      state: 'state',
    });

    return new shopify.clients.Graphql({ session });
}


export async function getShopifyProductsBySku(skus: string[]): Promise<Product[]> {
    console.log(`Starting to fetch ${skus.length} products from Shopify by SKU.`);
    const shopifyClient = getShopifyClient();

    const products: Product[] = [];
    const skuBatches: string[][] = [];

    // Shopify's search query has a limit. Batch SKUs to avoid hitting it.
    // A reasonable batch size is ~40-50 SKUs.
    for (let i = 0; i < skus.length; i += 40) {
        skuBatches.push(skus.slice(i, i + 40));
    }

    console.log(`Processing ${skuBatches.length} batches of SKUs.`);

    let processedSkus = 0;
    for (const batch of skuBatches) {
        const query = batch.map(sku => `sku:${JSON.stringify(sku)}`).join(' OR ');
        
        try {
            console.log(`Fetching products for batch with query: ${query}`);
            await sleep(500); // Add a small delay between each request to be safe

            const response: any = await shopifyClient.query({
                data: {
                    query: GET_PRODUCTS_BY_SKU_QUERY,
                    variables: {
                        query: query,
                    }
                }
            });
            
            if (response.body.errors) {
              console.error('GraphQL Errors:', response.body.errors);
              if (JSON.stringify(response.body.errors).includes('Throttled')) {
                 console.log("Throttled by Shopify, waiting 5 seconds before retrying...");
                 await sleep(5000);
                 // We should ideally retry the same batch, but for simplicity we'll continue
              }
              // Don't throw, just log the error and continue with what we have
              // throw new Error(`GraphQL Error: ${JSON.stringify(response.body.errors)}`);
            }

            const productEdges = response.body.data?.products?.edges || [];
            console.log(`Received ${productEdges.length} product nodes in this batch.`);

            for (const productEdge of productEdges) {
                for (const variantEdge of productEdge.node.variants.edges) {
                    const variant = variantEdge.node;
                     if(variant && variant.sku) {
                        products.push({
                            id: productEdge.node.id,
                            variantId: variant.id,
                            inventoryItemId: variant.inventoryItem?.id,
                            handle: productEdge.node.handle,
                            sku: variant.sku,
                            name: productEdge.node.title,
                            price: parseFloat(variant.price),
                            inventory: variant.inventoryQuantity,
                            descriptionHtml: productEdge.node.bodyHtml,
                        });
                    }
                }
            }
            processedSkus += batch.length;
            console.log(`Processed ${processedSkus}/${skus.length} SKUs`);

        } catch (error) {
            console.error("Error during Shopify product fetch loop:", error);
             if (error instanceof Error && error.message.includes('Throttled')) {
                console.log("Caught throttled error, waiting 5 seconds before retrying...");
                await sleep(5000);
            } else {
               // Don't rethrow, just log and continue with the next batch.
               console.error("An unexpected error occurred while fetching a batch. Skipping to next.", error);
            }
        }
    }
    
    console.log(`Finished fetching all Shopify products. Total found: ${products.length}`);
    return products;
}

export async function updateProduct(id: string, input: { title?: string, bodyHtml?: string }) {
    const shopifyClient = getShopifyClient();
    const response: any = await shopifyClient.query({
        data: {
            query: UPDATE_PRODUCT_MUTATION,
            variables: { input: { id, ...input } },
        },
    });

    const userErrors = response.body.data?.productUpdate?.userErrors;
    if (userErrors && userErrors.length > 0) {
        console.error("Error updating product:", userErrors);
        throw new Error(`Failed to update product: ${userErrors[0].message}`);
    }
    return response.body.data?.productUpdate?.product;
}

export async function updateProductVariant(id: string, input: { price?: number }) {
    const shopifyClient = getShopifyClient();
    const response: any = await shopifyClient.query({
        data: {
            query: UPDATE_PRODUCT_VARIANT_MUTATION,
            variables: { input: { id, ...input } },
        },
    });

    const userErrors = response.body.data?.productVariantUpdate?.userErrors;
    if (userErrors && userErrors.length > 0) {
        console.error("Error updating variant:", userErrors);
        throw new Error(`Failed to update variant: ${userErrors[0].message}`);
    }
    return response.body.data?.productVariantUpdate?.productVariant;
}

export async function updateInventoryLevel(inventoryItemId: string, quantity: number) {
    const shopifyClient = getShopifyClient();
    // To update inventory, we first need to find the inventory level ID for a specific location.
    // For this app, we'll assume the first available location.
    const locationsResponse: any = await shopifyClient.query({
        data: `{
            locations(first: 1) {
                edges {
                    node {
                        id
                    }
                }
            }
        }`
    });
    
    const locationId = locationsResponse.body.data?.locations?.edges[0]?.node?.id;
    if (!locationId) {
        throw new Error("Could not find a location to update inventory for.");
    }
    
    const response: any = await shopifyClient.query({
        data: {
            query: UPDATE_INVENTORY_LEVEL_MUTATION,
            variables: {
                input: {
                    reason: "correction",
                    setQuantities: [
                        {
                            inventoryItemId: inventoryItemId,
                            locationId: locationId,
                            quantity: quantity
                        }
                    ]
                }
            },
        },
    });
    
    const userErrors = response.body.data?.inventorySetOnHandQuantities?.userErrors;
    if (userErrors && userErrors.length > 0) {
        console.error("Error updating inventory:", userErrors);
        throw new Error(`Failed to update inventory: ${userErrors[0].message}`);
    }
    return response.body.data?.inventorySetOnHandQuantities?.inventoryAdjustmentGroup;
}
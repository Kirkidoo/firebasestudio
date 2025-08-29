'use server';

import { shopifyApi, LATEST_API_VERSION, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import { Product } from '@/lib/types';

// Helper function to introduce a delay
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const GAMMA_WAREHOUSE_LOCATION_ID = 93998154045;

// --- GraphQL Queries ---

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

const GET_PRODUCT_ID_BY_HANDLE_QUERY = `
  query getProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
    }
  }
`;

const GET_COLLECTION_BY_TITLE_QUERY = `
  query getCollectionByTitle($query: String!) {
    collections(first: 1, query: $query) {
      edges {
        node {
          id
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

// --- Client Initialization ---

function getShopifyGraphQLClient() {
     if (!process.env.SHOPIFY_SHOP_NAME || !process.env.SHOPIFY_API_ACCESS_TOKEN) {
        console.error("Shopify environment variables are not set.");
        throw new Error("Shopify environment variables are not set. Please create a .env.local file.");
    }
    
    const shopify = shopifyApi({
      apiKey: 'dummy',
      apiSecretKey: 'dummy',
      scopes: ['read_products', 'write_products', 'read_inventory', 'write_inventory', 'read_locations'],
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

function getShopifyRestClient() {
     if (!process.env.SHOPIFY_SHOP_NAME || !process.env.SHOPIFY_API_ACCESS_TOKEN) {
        console.error("Shopify environment variables are not set.");
        throw new Error("Shopify environment variables are not set. Please create a .env.local file.");
    }
    
    const shopify = shopifyApi({
      apiKey: 'dummy',
      apiSecretKey: 'dummy',
      scopes: ['read_products', 'write_products', 'read_inventory', 'write_inventory', 'read_locations'],
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

    return new shopify.clients.Rest({ session, apiVersion: LATEST_API_VERSION });
}

// --- Data Fetching Functions ---

export async function getShopifyProductsBySku(skus: string[]): Promise<Product[]> {
    console.log(`Starting to fetch ${skus.length} products from Shopify by SKU.`);
    const shopifyClient = getShopifyGraphQLClient();

    const products: Product[] = [];
    const skuBatches: string[][] = [];

    for (let i = 0; i < skus.length; i += 40) {
        skuBatches.push(skus.slice(i, i + 40));
    }

    console.log(`Processing ${skuBatches.length} batches of SKUs.`);

    let processedSkus = 0;
    for (const batch of skuBatches) {
        const query = batch.map(sku => `sku:${JSON.stringify(sku)}`).join(' OR ');
        
        try {
            await sleep(500); 

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
              }
            }

            const productEdges = response.body.data?.products?.edges || [];

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
                            productType: null, // from CSV
                            vendor: null, // from CSV
                            compareAtPrice: null, // from CSV
                            costPerItem: null, // from CSV
                            barcode: null, // from CSV
                            weight: null, // from CSV
                            mediaUrl: null, // from CSV
                            category: null, // from CSV
                        });
                    }
                }
            }
            processedSkus += batch.length;
            console.log(`Processed ${processedSkus}/${skus.length} SKUs, found ${products.length} products so far.`);

        } catch (error) {
            console.error("Error during Shopify product fetch loop:", error);
             if (error instanceof Error && error.message.includes('Throttled')) {
                console.log("Caught throttled error, waiting 5 seconds before retrying...");
                await sleep(5000);
            } else {
               console.error("An unexpected error occurred while fetching a batch. Skipping to next.", error);
            }
        }
    }
    
    console.log(`Finished fetching all Shopify products. Total found: ${products.length}`);
    return products;
}

export async function getShopifyLocations(): Promise<{id: number; name: string}[]> {
    const shopifyClient = getShopifyRestClient();
    try {
        const response: any = await shopifyClient.get({ path: 'locations' });
        return response.body.locations;
    } catch(error: any) {
        console.error("Error fetching Shopify locations:", error.response?.body || error);
        throw new Error(`Failed to fetch locations: ${JSON.stringify(error.response?.body?.errors || error.message)}`);
    }
}

// --- Data Mutation Functions ---

export async function createProduct(product: Product): Promise<{id: string, variantId: string, inventoryItemId: string}> {
    const shopifyClient = getShopifyRestClient();
    
    const sanitizedDescription = product.descriptionHtml
        ? product.descriptionHtml.replace(/<h1/gi, '<h2').replace(/<\/h1>/gi, '</h2>')
        : '';
        
    const restVariant = {
        price: product.price,
        sku: product.sku,
        compare_at_price: product.compareAtPrice,
        cost: product.costPerItem,
        barcode: product.barcode,
        grams: product.weight,
        inventory_management: 'shopify',
        inventory_policy: 'deny',
        option1: "Default Title"
    };

    const productPayload: any = {
        product: {
            title: product.name,
            handle: product.handle,
            body_html: sanitizedDescription,
            vendor: product.vendor,
            product_type: product.productType,
            status: 'active',
            variants: [restVariant],
            options: [{ name: "Title", values: ["Default Title"] }],
            images: product.mediaUrl ? [{ src: product.mediaUrl, alt: product.name }] : [],
        }
    };

    console.log('Creating product with REST payload:', JSON.stringify(productPayload, null, 2));

    try {
        const response: any = await shopifyClient.post({
            path: 'products',
            data: productPayload,
        });

        const createdProduct = response.body.product;
        const variant = createdProduct?.variants[0];

        if (!createdProduct || !variant) {
            console.error("Incomplete REST creation response:", response.body);
            throw new Error('Product creation did not return the expected product data.');
        }
        
        return { 
            id: createdProduct.admin_graphql_api_id, 
            variantId: `gid://shopify/ProductVariant/${variant.id}`,
            inventoryItemId: `gid://shopify/InventoryItem/${variant.inventory_item_id}`,
        };
    } catch(error: any) {
        console.error("Error creating product via REST:", error.response?.body || error);
        throw new Error(`Failed to create product. Status: ${error.response?.statusCode} Body: ${JSON.stringify(error.response?.body)}`);
    }
}


export async function addProductVariant(product: Product): Promise<{id: string, inventoryItemId: string}> {
    const shopifyClient = getShopifyRestClient();
    const graphQLClient = getShopifyGraphQLClient();

    const productResponse: any = await graphQLClient.query({
        data: {
            query: GET_PRODUCT_ID_BY_HANDLE_QUERY,
            variables: { handle: product.handle },
        },
    });

    const productGid = productResponse.body.data?.productByHandle?.id;
    if (!productGid) {
        throw new Error(`Could not find product with handle ${product.handle} to add variant to.`);
    }
    const productId = productGid.split('/').pop();

    const variantPayload: any = {
      variant: {
        price: product.price,
        sku: product.sku,
        compare_at_price: product.compareAtPrice,
        cost: product.costPerItem,
        barcode: product.barcode,
        grams: product.weight,
        inventory_management: 'shopify',
        inventory_policy: 'deny',
        // This is a simplification; real multi-option products need all options
        option1: product.sku 
      }
    }
    
    console.log(`Adding product variant to product ID ${productId} with REST payload:`, variantPayload);

    try {
        const response: any = await shopifyClient.post({
            path: `products/${productId}/variants`,
            data: variantPayload,
        });

        const createdVariant = response.body.variant;
        if (!createdVariant) {
            throw new Error('Variant creation did not return the expected variant data.');
        }

        return { 
            id: `gid://shopify/ProductVariant/${createdVariant.id}`, 
            inventoryItemId: `gid://shopify/InventoryItem/${createdVariant.inventory_item_id}`,
        };
    } catch (error: any) {
         console.error("Error adding variant via REST:", error.response?.body || error);
         throw new Error(`Failed to add variant. Status: ${error.response?.statusCode} Body: ${JSON.stringify(error.response?.body)}`);
    }
}


export async function updateProduct(id: string, input: { title?: string, bodyHtml?: string }) {
    const shopifyClient = getShopifyGraphQLClient();
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
    const shopifyClient = getShopifyGraphQLClient();
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

// --- Inventory and Collection Functions ---

export async function connectInventoryToLocation(inventoryItemId: string, locationId: number) {
    const shopifyClient = getShopifyRestClient();
    const numericInventoryItemId = inventoryItemId.split('/').pop();
    
    try {
        await shopifyClient.post({
            path: 'inventory_levels/connect',
            data: {
                location_id: locationId,
                inventory_item_id: numericInventoryItemId,
            },
        });
        console.log(`Successfully connected inventory item ${inventoryItemId} to location ${locationId}.`);
    } catch(error: any) {
        const errorBody = error.response?.body;
        if (errorBody && errorBody.errors && JSON.stringify(errorBody.errors).includes('is already stocked at the location')) {
             console.log(`Inventory item ${inventoryItemId} was already connected to location ${locationId}.`);
             return;
        }
        console.error(`Error connecting inventory item ${inventoryItemId} to location ${locationId}:`, errorBody || error);
        throw new Error(`Failed to connect inventory to location: ${JSON.stringify(errorBody?.errors || error.message)}`);
    }
}

export async function disconnectInventoryFromLocation(inventoryItemId: string, locationId: number) {
    const shopifyClient = getShopifyRestClient();
    const numericInventoryItemId = inventoryItemId.split('/').pop();
    
    try {
        await shopifyClient.delete({
            path: 'inventory_levels',
            query: {
                inventory_item_id: numericInventoryItemId,
                location_id: locationId,
            }
        });
        console.log(`Successfully disconnected inventory item ${inventoryItemId} from location ${locationId}.`);
    } catch(error: any) {
        const errorBody = error.response?.body;
        console.error(`Error disconnecting inventory item ${inventoryItemId} from location ${locationId}:`, errorBody || error);
        // Don't throw an error, just log it, as this is a non-critical cleanup step.
    }
}


export async function updateInventoryLevel(inventoryItemId: string, quantity: number, locationId: number) {
    const shopifyClient = getShopifyRestClient();
    const numericInventoryItemId = inventoryItemId.split('/').pop();

    try {
        await shopifyClient.post({
            path: 'inventory_levels/set',
            data: {
                inventory_item_id: numericInventoryItemId,
                location_id: locationId,
                available: quantity,
            },
        });
        console.log(`Successfully set inventory for item ${inventoryItemId} at location ${locationId} to ${quantity}.`);
    } catch (error: any) {
        console.error("Error updating inventory via REST:", error.response?.body || error);
        throw new Error(`Failed to update inventory: ${JSON.stringify(error.response?.body?.errors || error.message)}`);
    }
}

export async function getCollectionIdByTitle(title: string): Promise<string | null> {
    const shopifyClient = getShopifyGraphQLClient();
    const formattedQuery = `title:"${title}"`;
    try {
        const response: any = await shopifyClient.query({
            data: {
                query: GET_COLLECTION_BY_TITLE_QUERY,
                variables: { query: formattedQuery },
            },
        });
        const collectionEdge = response.body.data?.collections?.edges?.[0];
        return collectionEdge?.node?.id || null;
    } catch (error) {
        console.error(`Error fetching collection ID for title "${title}":`, error);
        return null;
    }
}

export async function linkProductToCollection(productGid: string, collectionGid: string) {
    const shopifyClient = getShopifyRestClient();
    const legacyProductId = productGid.split('/').pop();
    const legacyCollectionId = collectionGid.split('/').pop();
    
    try {
        await shopifyClient.post({
            path: 'collects',
            data: {
                collect: {
                    product_id: legacyProductId,
                    collection_id: legacyCollectionId,
                },
            },
        });
        console.log(`Successfully linked product ${productGid} to collection ${collectionGid}.`);
    } catch(error: any) {
        console.error(`Error linking product ${productGid} to collection ${collectionGid}:`, error.response?.body || error);
        // Don't throw, just warn, as this is a post-creation task.
    }
}
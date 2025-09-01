

'use server';

import { shopifyApi, LATEST_API_VERSION, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import { Product, ShopifyProductImage } from '@/lib/types';
import { Readable, Writable } from 'stream';
import { createReadStream } from 'fs';
import { S_IFREG } from 'constants';
import { request } from 'http';

// Helper function to introduce a delay
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const GAMMA_WAREHOUSE_LOCATION_ID = 93998154045;

// --- GraphQL Queries & Mutations ---

const GET_PRODUCTS_BY_SKU_QUERY = `
  query getProductsBySku($query: String!) {
    products(first: 250, query: $query) {
      edges {
        node {
          id
          title
          handle
          bodyHtml
          priceRange {
            minVariantPrice {
              amount
            }
          }
          featuredImage {
            url
          }
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
                image {
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

const GET_ALL_PUBLICATIONS_QUERY = `
  query getPublications {
    publications(first: 50) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;

const PUBLISHABLE_PUBLISH_MUTATION = `
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable {
        ... on Product {
          availablePublicationsCount {
            count
          }
        }
      }
      userErrors {
        field
        message
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


const BULK_OPERATION_RUN_QUERY_MUTATION = `
  mutation bulkOperationRunQuery($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_CURRENT_BULK_OPERATION_QUERY = `
  query {
    currentBulkOperation {
      id
      status
      errorCode
      createdAt
      completedAt
      objectCount
      fileSize
      url
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

    const allProducts: Product[] = [];
    const skuBatches: string[][] = [];
    const requestedSkuSet = new Set(skus);

    // Reduce batch size to avoid hitting query complexity limits
    for (let i = 0; i < skus.length; i += 40) {
        skuBatches.push(skus.slice(i, i + 40));
    }

    console.log(`Processing ${skuBatches.length} batches of SKUs.`);

    let processedSkusCount = 0;
    for (const batch of skuBatches) {
        // The query remains broad to fetch potential matches.
        const query = batch.map(sku => `sku:${sku}`).join(' OR ');
        
        try {
            await sleep(500); // Rate limiting

            const response: any = await shopifyClient.query({
                data: {
                    query: GET_PRODUCTS_BY_SKU_QUERY,
                    variables: { query },
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
                        // **CRITICAL FIX**: Manually filter for exact SKU match here.
                        if (requestedSkuSet.has(variant.sku)) {
                            allProducts.push({
                                id: productEdge.node.id,
                                variantId: variant.id,
                                inventoryItemId: variant.inventoryItem?.id,
                                handle: productEdge.node.handle,
                                sku: variant.sku,
                                name: productEdge.node.title,
                                price: parseFloat(variant.price),
                                inventory: variant.inventoryQuantity,
                                descriptionHtml: productEdge.node.bodyHtml,
                                productType: null,
                                vendor: null,
                                tags: null,
                                compareAtPrice: null,
                                costPerItem: null,
                                barcode: null,
                                weight: null,
                                mediaUrl: productEdge.node.featuredImage?.url || null,
                                imageId: variant.image?.id ? parseInt(variant.image.id.split('/').pop(), 10) : null,
                                category: null,
                                option1Name: null,
                                option1Value: null,
                                option2Name: null,
                                option2Value: null,
                                option3Name: null,
                                option3Value: null,
                                templateSuffix: null,
                            });
                        }
                    }
                }
            }
            processedSkusCount += batch.length;
            console.log(`Processed ${processedSkusCount}/${skus.length} SKUs, found ${allProducts.length} exact matches so far.`);

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
    
    console.log(`Finished fetching all Shopify products. Total exact matches found: ${allProducts.length}`);
    return allProducts;
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

export async function getFullProduct(productId: number): Promise<any> {
    const shopifyClient = getShopifyRestClient();
    try {
        const response: any = await shopifyClient.get({ path: `products/${productId}` });
        return response.body.product;
    } catch(error: any) {
        console.error(`Error fetching full product for ID ${productId}:`, error.response?.body || error);
        throw new Error(`Failed to fetch product: ${JSON.stringify(error.response?.body?.errors || error.message)}`);
    }
}

// --- Data Mutation Functions ---

export async function createProduct(productVariants: Product[], addClearanceTag: boolean): Promise<any> {
    const shopifyClient = getShopifyRestClient();
    
    const firstVariant = productVariants[0];
    const sanitizedDescription = firstVariant.descriptionHtml
        ? firstVariant.descriptionHtml.replace(/<h1/gi, '<h2').replace(/<\/h1>/gi, '</h2>')
        : '';
        
    const isSingleDefaultVariant = productVariants.length === 1 && 
        (firstVariant.option1Name === 'Title' && firstVariant.option1Value === 'Default Title');

    const getOptionValue = (value: string | null | undefined, fallback: string) => (value?.trim() ? value.trim() : fallback);

    // --- Duplicate Variant Option Handling ---
    const processedVariants = [...productVariants]; // Create a mutable copy
    const seenOptionValues = new Set<string>();

    for (const variant of processedVariants) {
        const optionKey = [variant.option1Value, variant.option2Value, variant.option3Value].filter(Boolean).join('/');
        if (seenOptionValues.has(optionKey)) {
            console.log(`Duplicate option values found for "${optionKey}". Uniquifying with SKU.`);
            // Uniquify by appending SKU. This logic assumes Option1 is the primary one being duplicated.
            if (variant.option1Value) {
                variant.option1Value = `${variant.option1Value}-${variant.sku}`;
            }
        }
        seenOptionValues.add([variant.option1Value, variant.option2Value, variant.option3Value].filter(Boolean).join('/'));
    }
    // --- End Duplicate Handling ---

    // Determine unique option names from the first variant
    const optionNames: string[] = [];
    if (firstVariant.option1Name && !isSingleDefaultVariant) optionNames.push(firstVariant.option1Name);
    if (firstVariant.option2Name) optionNames.push(firstVariant.option2Name);
    if (firstVariant.option3Name) optionNames.push(firstVariant.option3Name);
    
    const restOptions = optionNames.length > 0 ? optionNames.map(name => ({ name })) : [];
    
    const restVariants = processedVariants.map(p => {
        const variantPayload: any = {
            price: p.price,
            sku: p.sku,
            barcode: p.barcode,
            compare_at_price: p.compareAtPrice,
            inventory_management: 'shopify',
            inventory_policy: 'deny',
            requires_shipping: true,
            weight: p.weight ? p.weight / 453.592 : 0, // Convert grams to lbs
            weight_unit: 'lb',
            cost: p.costPerItem,
        };

        if (!isSingleDefaultVariant) {
            if (p.option1Name) variantPayload.option1 = getOptionValue(p.option1Value, p.sku);
            if (p.option2Name) variantPayload.option2 = getOptionValue(p.option2Value, null);
            if (p.option3Name) variantPayload.option3 = getOptionValue(p.option3Value, null);
        }

        return variantPayload;
    });

    const uniqueImageUrls = [...new Set(processedVariants.map(p => p.mediaUrl).filter(Boolean))];
    const restImages = uniqueImageUrls.map(url => ({ src: url }));

    const tags = addClearanceTag ? 'Clearance' : '';


    const productPayload: any = {
        product: {
            title: firstVariant.name,
            handle: firstVariant.handle,
            body_html: sanitizedDescription,
            vendor: firstVariant.vendor,
            product_type: firstVariant.productType,
            status: 'active',
            tags: tags,
            variants: restVariants,
            images: restImages,
        }
    };
    
    if(restOptions.length > 0) {
        productPayload.product.options = restOptions;
    }

    // Assign heavy product template if weight > 50 lbs (22679.6 grams)
    const isHeavy = productVariants.some(p => p.weight && p.weight > 22679.6);
    if (isHeavy) {
        productPayload.product.template_suffix = 'heavy-products';
        console.log(`Product ${firstVariant.handle} is over 50lbs, assigning 'heavy-products' template.`);
    }

    console.log('Phase 1: Creating product with REST payload:', JSON.stringify(productPayload, null, 2));

    try {
        const response: any = await shopifyClient.post({
            path: 'products',
            data: productPayload,
        });

        const createdProduct = response.body.product;

        if (!createdProduct || !createdProduct.variants) {
            console.error("Incomplete REST creation response:", response.body);
            throw new Error('Product creation did not return the expected product data.');
        }
        
        console.log('Phase 1: Product created successfully.');
        return createdProduct;

    } catch(error: any) {
        console.error("Error creating product via REST:", error.response?.body || error);
        throw new Error(`Failed to create product. Status: ${error.response?.statusCode} Body: ${JSON.stringify(error.response?.body)}`);
    }
}


export async function addProductVariant(product: Product): Promise<any> {
    const shopifyClient = getShopifyRestClient();
    const graphQLClient = getShopifyGraphQLClient();

    // Find the parent product's ID using its handle
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

    const getOptionValue = (value: string | null | undefined, fallback: string) => (value?.trim() ? value.trim() : fallback);

    const variantPayload: any = {
      variant: {
        price: product.price,
        sku: product.sku,
        compare_at_price: product.compareAtPrice,
        cost: product.costPerItem,
        barcode: product.barcode,
        weight: product.weight ? product.weight / 453.592 : 0, // Convert grams to lbs
        weight_unit: 'lb',
        inventory_management: 'shopify',
        inventory_policy: 'deny',
        option1: getOptionValue(product.option1Value, product.sku),
        option2: getOptionValue(product.option2Value, null),
        option3: getOptionValue(product.option3Value, null)
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
        
        const fullProductResponse:any = await shopifyClient.get({ path: `products/${productId}` });

        return fullProductResponse.body.product;
        
    } catch (error: any) {
         console.error("Error adding variant via REST:", error.response?.body || error);
         throw new Error(`Failed to add variant. Status: ${error.response?.statusCode} Body: ${JSON.stringify(error.response?.body)}`);
    }
}


export async function updateProduct(id: string, input: { title?: string, bodyHtml?: string }) {
    // If we are only updating the title, we can use the more efficient GraphQL mutation
    if (input.title && !input.bodyHtml) {
        const shopifyClient = getShopifyGraphQLClient();
        const response: any = await shopifyClient.query({
            data: {
                query: UPDATE_PRODUCT_MUTATION,
                variables: { input: { id, title: input.title } },
            },
        });
        const userErrors = response.body.data?.productUpdate?.userErrors;
        if (userErrors && userErrors.length > 0) {
            console.error("Error updating product title via GraphQL:", userErrors);
            throw new Error(`Failed to update product: ${userErrors[0].message}`);
        }
        return response.body.data?.productUpdate?.product;
    }
    
    // For other updates, like bodyHtml, use the REST API
    const shopifyClient = getShopifyRestClient();
    const numericProductId = id.split('/').pop();

    if (!numericProductId) {
        throw new Error(`Invalid Product ID GID for REST update: ${id}`);
    }

    const payload = {
        product: {
            id: numericProductId,
            body_html: input.bodyHtml,
        }
    };
    
    if (input.title) {
        (payload.product as any).title = input.title;
    }

    try {
        const response: any = await shopifyClient.put({
            path: `products/${numericProductId}`,
            data: payload,
        });
         if (response.body.errors) {
            console.error("Error updating product via REST:", response.body.errors);
            throw new Error(`Failed to update product: ${JSON.stringify(response.body.errors)}`);
        }
        return response.body.product;

    } catch(error: any) {
        console.error("Error during product update via REST:", error.response?.body || error);
        throw new Error(`Failed to update product. Status: ${error.response?.statusCode} Body: ${JSON.stringify(error.response?.body)}`);
    }
}


export async function updateProductVariant(variantId: number, input: { image_id?: number, price?: number }) {
    const shopifyClient = getShopifyRestClient();
    
    const payload = { variant: { id: variantId, ...input }};
    
    console.log(`Phase 2: Updating variant ${variantId} with REST payload:`, JSON.stringify(payload, null, 2));

    try {
        const response: any = await shopifyClient.put({
            path: `variants/${variantId}`,
            data: payload,
        });

        if (response.body.errors) {
            console.error("Error updating variant via REST:", response.body.errors);
            throw new Error(`Failed to update variant: ${JSON.stringify(response.body.errors)}`);
        }
        
        return response.body.variant;
    } catch (error: any) {
        console.error("Error during variant update:", error.response?.body || error);
        throw new Error(`Failed to update variant. Status: ${error.response?.statusCode} Body: ${JSON.stringify(error.response?.body)}`);
    }
}

export async function deleteProduct(productId: string): Promise<void> {
    const shopifyClient = getShopifyRestClient();
    const numericProductId = productId.split('/').pop();

    if (!numericProductId) {
        throw new Error(`Invalid Product ID GID: ${productId}`);
    }

    console.log(`Attempting to delete product with ID: ${numericProductId}`);
    try {
        await shopifyClient.delete({
            path: `products/${numericProductId}`,
        });
        console.log(`Successfully deleted product ID: ${numericProductId}`);
    } catch (error: any) {
        console.error(`Error deleting product ID ${numericProductId}:`, error.response?.body || error);
        throw new Error(`Failed to delete product. Status: ${error.response?.statusCode} Body: ${JSON.stringify(error.response?.body)}`);
    }
}

export async function deleteProductVariant(productId: number, variantId: number): Promise<void> {
    const shopifyClient = getShopifyRestClient();
    console.log(`Attempting to delete variant ${variantId} from product ${productId}`);
    try {
        await shopifyClient.delete({
            path: `products/${productId}/variants/${variantId}`,
        });
        console.log(`Successfully deleted variant ID ${variantId} from product ID ${productId}`);
    } catch (error: any) {
        console.error(`Error deleting variant ID ${variantId}:`, error.response?.body || error);
        throw new Error(`Failed to delete variant. Status: ${error.response?.statusCode} Body: ${JSON.stringify(error.response?.body)}`);
    }
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
        // Check if the error is that it's already stocked, which is not a failure condition for us.
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
         if (error.response?.body) {
            console.error("Error updating inventory via REST:", error.response.body);
            throw new Error(`Failed to update inventory: ${JSON.stringify(error.response.body.errors || error.message)}`);
        }
        throw error;
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
        // Don't throw, just warn, as this is a post-creation task.
        // It might fail if the link already exists, which is not a critical error.
        console.warn(`Could not link product ${productGid} to collection ${collectionGid}:`, error.response?.body || error);
    }
}

export async function publishProductToSalesChannels(productGid: string): Promise<void> {
    const shopifyClient = getShopifyGraphQLClient();
    
    // 1. Fetch all available publications
    const publicationsResponse: any = await shopifyClient.query({ data: { query: GET_ALL_PUBLICATIONS_QUERY } });
    const publications = publicationsResponse.body.data?.publications?.edges.map((edge: any) => edge.node) || [];
    
    if (publications.length === 0) {
        console.warn(`No sales channel publications found to publish product ${productGid} to.`);
        return;
    }

    const publicationInputs = publications.map((pub: { id: string }) => ({ publicationId: pub.id }));

    // 2. Publish the product to all publications
    try {
        const result: any = await shopifyClient.query({
            data: {
                query: PUBLISHABLE_PUBLISH_MUTATION,
                variables: {
                    id: productGid,
                    input: publicationInputs
                }
            }
        });

        const userErrors = result.body.data?.publishablePublish?.userErrors;
        if (userErrors && userErrors.length > 0) {
            const errorMessages = userErrors.map((e: any) => e.message).join('; ');
            console.warn(`Could not publish product ${productGid} to all sales channels: ${errorMessages}`);
        } else {
            console.log(`Successfully requested to publish product ${productGid} to ${publications.length} sales channels.`);
        }
    } catch(error) {
        console.error(`Error during publishProductToSalesChannels for product ${productGid}:`, error);
        // Don't throw, just warn
    }
}


// --- MEDIA FUNCTIONS ---
export async function addProductImage(productId: number, imageUrl: string): Promise<ShopifyProductImage> {
    const shopifyClient = getShopifyRestClient();
    try {
        const response: any = await shopifyClient.post({
            path: `products/${productId}/images`,
            data: {
                image: {
                    src: imageUrl,
                },
            },
        });
        return response.body.image;
    } catch (error: any) {
        console.error(`Error adding image to product ${productId}:`, error.response?.body || error);
        throw new Error(`Failed to add image: ${JSON.stringify(error.response?.body?.errors || error.message)}`);
    }
}

export async function deleteProductImage(productId: number, imageId: number): Promise<void> {
    const shopifyClient = getShopifyRestClient();
    try {
        await shopifyClient.delete({
            path: `products/${productId}/images/${imageId}`,
        });
    } catch (error: any) {
        console.error(`Error deleting image ${imageId} from product ${productId}:`, error.response?.body || error);
        throw new Error(`Failed to delete image: ${JSON.stringify(error.response?.body?.errors || error.message)}`);
    }
}


// --- BULK OPERATIONS ---

export async function startProductExportBulkOperation(): Promise<{ id: string, status: string }> {
    const shopifyClient = getShopifyGraphQLClient();
    
    // First, check if an operation is already running.
    const currentOpResponse: any = await shopifyClient.query({
        data: { query: GET_CURRENT_BULK_OPERATION_QUERY },
    });
    const currentOperation = currentOpResponse.body.data?.currentBulkOperation;
    if (currentOperation && (currentOperation.status === 'RUNNING' || currentOperation.status === 'CREATED')) {
        console.log(`Found existing bulk operation: ${currentOperation.id}. Recovering...`);
        return { id: currentOperation.id, status: currentOperation.status };
    }


    const query = `
        query {
            products {
                edges {
                    node {
                        id
                        title
                        handle
                        vendor
                        productType
                        bodyHtml
                        templateSuffix
                        variants {
                            edges {
                                node {
                                    id
                                    sku
                                    price
                                    weight
                                    inventoryQuantity
                                    inventoryItem {
                                        id
                                    }
                                    image {
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

    const response: any = await shopifyClient.query({
        data: {
            query: BULK_OPERATION_RUN_QUERY_MUTATION,
            variables: { query },
        },
    });

    const userErrors = response.body.data?.bulkOperationRunQuery?.userErrors;
    if (userErrors && userErrors.length > 0) {
        throw new Error(`Failed to start bulk operation: ${userErrors[0].message}`);
    }

    const bulkOperation = response.body.data?.bulkOperationRunQuery?.bulkOperation;
    if (!bulkOperation) {
        throw new Error("Could not start bulk operation.");
    }
    
    return bulkOperation;
}

export async function checkBulkOperationStatus(id: string): Promise<{ id: string, status: string, resultUrl?: string }> {
    const shopifyClient = getShopifyGraphQLClient();
    
    const currentOpResponse: any = await shopifyClient.query({
        data: { query: GET_CURRENT_BULK_OPERATION_QUERY },
    });

    const operation = currentOpResponse.body.data?.currentBulkOperation;
    
    if (operation && operation.id !== id && operation.status === 'RUNNING') {
        // A different operation is running. Our job is likely queued. Keep polling.
        console.warn(`Polling for operation ${id}, but a different operation ${operation.id} is currently running. Continuing to poll.`);
        return { id: id, status: 'RUNNING' };
    }

    if (operation && operation.id === id) {
        // Our operation is the current one. Return its status.
        return { id: operation.id, status: operation.status, resultUrl: operation.url };
    }

    // If we get here, it means there's no running operation. Our job must be done (or failed/cancelled).
    // We need to query for it specifically to get the final URL.
    const specificOpQuery = `
      query getSpecificBulkOperation($id: ID!) {
        node(id: $id) {
          ... on BulkOperation {
            id
            status
            url
            errorCode
          }
        }
      }
    `;
    const specificOpResponse: any = await shopifyClient.query({
        data: {
            query: specificOpQuery,
            variables: { id }
        }
    });

    const specificOperation = specificOpResponse.body.data?.node;

    if (specificOperation) {
         if (specificOperation.status === 'FAILED') {
            console.error(`Bulk operation ${id} failed with code: ${specificOperation.errorCode}`);
         }
         return { id: specificOperation.id, status: specificOperation.status, resultUrl: specificOperation.url };
    }
    
    // If even the specific query fails, we have an issue.
    throw new Error(`Could not retrieve status for bulk operation ${id}.`);
}

export async function getBulkOperationResult(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download bulk operation result from ${url}`);
    }
    return response.text();
}

export async function parseBulkOperationResult(jsonlContent: string): Promise<Product[]> {
    const lines = jsonlContent.split('\n').filter(line => line.trim() !== '');
    const products: Product[] = [];
    const parentProducts = new Map<string, any>();

    // First pass: map all parent products by their ID
    for (const line of lines) {
        const item = JSON.parse(line);
        if (item.id.includes('gid://shopify/Product/')) {
            parentProducts.set(item.id, item);
        }
    }

    // Second pass: create product entries for each variant, linking to its parent
    for (const line of lines) {
        const shopifyProduct = JSON.parse(line);
        
        if (shopifyProduct.id.includes('gid://shopify/ProductVariant')) {
            const variantId = shopifyProduct.id;
            const sku = shopifyProduct.sku;
            const parentId = shopifyProduct.__parentId;
            
            const parentProduct = parentProducts.get(parentId);
            
            if (parentProduct && sku) {
                products.push({
                    id: parentProduct.id,
                    variantId: variantId,
                    inventoryItemId: shopifyProduct.inventoryItem?.id,
                    handle: parentProduct.handle,
                    sku: sku,
                    name: parentProduct.title,
                    price: parseFloat(shopifyProduct.price),
                    inventory: shopifyProduct.inventoryQuantity,
                    descriptionHtml: parentProduct.bodyHtml,
                    productType: parentProduct.productType,
                    vendor: parentProduct.vendor,
                    tags: null,
                    compareAtPrice: null,
                    costPerItem: null,
                    barcode: null,
                    weight: shopifyProduct.weight, // weight in grams
                    mediaUrl: null, // Note: Bulk export doesn't easily link variant images
                    imageId: shopifyProduct.image?.id ? parseInt(shopifyProduct.image.id.split('/').pop(), 10) : null,
                    category: null,
                    option1Name: null,
                    option1Value: null,
                    option2Name: null,
                    option2Value: null,
                    option3Name: null,
                    option3Value: null,
                    templateSuffix: parentProduct.templateSuffix
                });
            }
        }
    }
    console.log(`Parsed ${products.length} products from bulk operation result.`);
    return products;
}
    

    

    

    


    

    

    